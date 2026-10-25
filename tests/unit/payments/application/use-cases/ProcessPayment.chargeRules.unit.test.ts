import { ProcessPayment } from '../../../../../src/modules/payments/application/use-cases/ProcessPayment';
import { AppointmentChargeGuard } from '../../../../../src/modules/payments/application/services/AppointmentChargeGuard';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { PaymentGatewayError } from '../../../../../src/modules/payments/domain/gateways/PaymentGatewayError';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';
import {
  Payment,
  PaymentProps,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';
import { ConflictError } from '../../../../../src/shared/exceptions/ConflictError';

describe('ProcessPayment - charge rules', () => {
  let processPayment: ProcessPayment;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let fakeGateway: FakePaymentGateway;
  let pendingPayment: Payment;

  const appointmentId = '123e4567-e89b-12d3-a456-426614174001';
  const stylistId = '123e4567-e89b-12d3-a456-426614174010';
  const otherStylistId = '123e4567-e89b-12d3-a456-426614174020';
  const adminId = '123e4567-e89b-12d3-a456-426614174099';

  const appointment = {
    id: appointmentId,
    stylistId,
    clientId: '123e4567-e89b-12d3-a456-426614174011',
    userId: '123e4567-e89b-12d3-a456-426614174011',
  };

  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);
  const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

  /**
   * Pago de pasarela PENDING de la misma cita, con el checkout vencido hace una hora
   */
  const gatewayCheckout = (overrides: Partial<PaymentProps> = {}): Payment =>
    new Payment({
      id: 'gateway-payment-id',
      amount: 85,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId,
      provider: PaymentProviderEnum.MERCADO_PAGO,
      idempotencyKey: 'gateway-key',
      checkoutUrl: 'https://checkout.example/gateway',
      gatewayPreferenceId: 'gateway-preference-id',
      checkoutExpiresAt: minutesAgo(60),
      createdAt: minutesAgo(90),
      updatedAt: minutesAgo(90),
      ...overrides,
    });

  const completedManualPayment = (): Payment => {
    const payment = Payment.create('completed-manual-id', 85, appointmentId);
    payment.markAsCompleted(PaymentMethodEnum.CASH);
    return payment;
  };

  const processAsAdmin = () =>
    processPayment.execute(
      { paymentId: pendingPayment.id, method: PaymentMethodEnum.CASH },
      adminId,
      'ADMIN',
    );

  beforeEach(() => {
    mockPaymentRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByAppointmentId: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getStatistics: jest.fn(),
      getTotalByAppointment: jest.fn(),
    };

    mockAppointmentRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IAppointmentRepository>;

    fakeGateway = new FakePaymentGateway();

    pendingPayment = Payment.create('pending-manual-id', 85, appointmentId);

    mockAppointmentRepository.findById.mockResolvedValue(appointment as any);
    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
    mockPaymentRepository.findByAppointmentId.mockResolvedValue([pendingPayment]);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    processPayment = new ProcessPayment(
      mockPaymentRepository,
      mockAppointmentRepository,
      new AppointmentChargeGuard(mockPaymentRepository, fakeGateway),
    );
  });

  describe('Cobro único por cita', () => {
    // Debería completar el pago si es el único pago de la cita
    it('should complete the payment when it is the only payment of the appointment', async () => {
      const result = await processAsAdmin();

      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(mockPaymentRepository.findByAppointmentId).toHaveBeenCalledWith(appointmentId);
    });

    // Debería lanzar ConflictError si la cita ya tiene otro pago manual completado
    it('should throw ConflictError when the appointment already has another completed manual payment', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        pendingPayment,
        completedManualPayment(),
      ]);

      const result = processAsAdmin();

      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toThrow(
        'This appointment already has a completed payment. This payment cannot be processed.',
      );
      expect(pendingPayment.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería lanzar ConflictError si el cliente pagó online entre la creación y el procesamiento
    it('should throw ConflictError when the client paid online after the payment was created', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        pendingPayment,
        gatewayCheckout({ status: PaymentStatusEnum.COMPLETED }),
      ]);

      await expect(processAsAdmin()).rejects.toThrow(
        'This appointment already has a completed payment',
      );
      expect(pendingPayment.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería lanzar ConflictError si la cita tiene un checkout de pasarela vigente
    it('should throw ConflictError when the appointment has an open gateway checkout', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        pendingPayment,
        gatewayCheckout({ checkoutExpiresAt: minutesFromNow(30) }),
      ]);

      await expect(processAsAdmin()).rejects.toThrow(
        'There is a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it, before processing a manual payment.',
      );
      expect(pendingPayment.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería completar el pago si el pago anterior de la cita fue reembolsado
    it('should complete the payment when the previous payment was refunded', async () => {
      const refunded = completedManualPayment();
      refunded.refund('Turno reprogramado');
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([pendingPayment, refunded]);

      const result = await processAsAdmin();

      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
    });
  });

  describe('Checkouts vencidos', () => {
    // Debería marcar FAILED un checkout vencido sin pago en la pasarela y completar el pago
    it('should mark an expired checkout without a gateway payment as FAILED and complete the payment', async () => {
      const expired = gatewayCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([pendingPayment, expired]);

      const result = await processAsAdmin();

      expect(expired.status).toBe(PaymentStatusEnum.FAILED);
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(pendingPayment);
      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
    });

    // Debería lanzar ConflictError si la pasarela tiene un pago aprobado para el checkout vencido
    it('should throw ConflictError when the gateway has an approved payment for the expired checkout', async () => {
      const expired = gatewayCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([pendingPayment, expired]);
      fakeGateway.paymentsByExternalReference.set('gateway-payment-id', {
        gatewayPaymentId: '181041671799',
        status: 'approved',
        externalReference: 'gateway-payment-id',
      });

      await expect(processAsAdmin()).rejects.toThrow('This payment cannot be processed');
      expect(expired.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(pendingPayment.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).not.toHaveBeenCalledWith(pendingPayment);
    });

    // Debería responder 502 sin completar el pago si la pasarela falla al revisar el checkout vencido
    it('should respond 502 without completing the payment when the gateway fails', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        pendingPayment,
        gatewayCheckout(),
      ]);
      fakeGateway.findByExternalReferenceError = new PaymentGatewayError('HTTP 503', 503);

      await expect(processAsAdmin()).rejects.toMatchObject({ statusCode: 502 });
      expect(pendingPayment.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('Orden de las validaciones', () => {
    // Debería responder que solo se procesan pagos pendientes antes de revisar los pagos de la cita
    it('should report that only pending payments can be processed before looking at the appointment payments', async () => {
      pendingPayment.markAsCompleted(PaymentMethodEnum.CASH);

      await expect(processAsAdmin()).rejects.toThrow('Only pending payments can be processed');
      expect(mockPaymentRepository.findByAppointmentId).not.toHaveBeenCalled();
    });

    // Debería rechazar un pago de pasarela antes de revisar los pagos de la cita
    it('should reject a gateway-backed payment before looking at the appointment payments', async () => {
      const gatewayPayment = gatewayCheckout({ checkoutExpiresAt: minutesFromNow(30) });
      mockPaymentRepository.findById.mockResolvedValue(gatewayPayment);

      await expect(
        processPayment.execute(
          { paymentId: gatewayPayment.id, method: PaymentMethodEnum.CASH },
          adminId,
          'ADMIN',
        ),
      ).rejects.toThrow(BusinessRuleError);
      expect(mockPaymentRepository.findByAppointmentId).not.toHaveBeenCalled();
    });

    // Debería rechazar por permisos antes de revisar los pagos de la cita
    it('should reject on permissions before looking at the appointment payments', async () => {
      await expect(
        processPayment.execute(
          { paymentId: pendingPayment.id, method: PaymentMethodEnum.CASH },
          otherStylistId,
          'STYLIST',
        ),
      ).rejects.toThrow(ForbiddenError);
      expect(mockPaymentRepository.findByAppointmentId).not.toHaveBeenCalled();
    });
  });
});
