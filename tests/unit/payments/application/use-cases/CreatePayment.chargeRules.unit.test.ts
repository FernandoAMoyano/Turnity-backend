import { CreatePayment } from '../../../../../src/modules/payments/application/use-cases/CreatePayment';
import { AppointmentChargeGuard } from '../../../../../src/modules/payments/application/services/AppointmentChargeGuard';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentStatusRepository';
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

describe('CreatePayment - charge rules', () => {
  let createPayment: CreatePayment;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let mockAppointmentStatusRepository: jest.Mocked<IAppointmentStatusRepository>;
  let fakeGateway: FakePaymentGateway;

  const appointmentId = '123e4567-e89b-12d3-a456-426614174001';
  const statusId = '123e4567-e89b-12d3-a456-426614174002';
  const stylistId = '123e4567-e89b-12d3-a456-426614174010';
  const otherStylistId = '123e4567-e89b-12d3-a456-426614174020';
  const adminId = '123e4567-e89b-12d3-a456-426614174099';

  const appointment = {
    id: appointmentId,
    statusId,
    stylistId,
    clientId: '123e4567-e89b-12d3-a456-426614174011',
    userId: '123e4567-e89b-12d3-a456-426614174011',
    serviceIds: [],
  };

  const dto = { amount: 85, appointmentId };

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

    mockAppointmentStatusRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IAppointmentStatusRepository>;

    fakeGateway = new FakePaymentGateway();

    mockAppointmentRepository.findById.mockResolvedValue(appointment as any);
    mockAppointmentStatusRepository.findById.mockResolvedValue({
      id: statusId,
      name: 'CONFIRMED',
      description: '',
    } as any);
    mockPaymentRepository.findByAppointmentId.mockResolvedValue([]);
    mockPaymentRepository.save.mockImplementation(async (payment) => payment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    createPayment = new CreatePayment(
      mockPaymentRepository,
      mockAppointmentRepository,
      mockAppointmentStatusRepository,
      new AppointmentChargeGuard(mockPaymentRepository, fakeGateway),
    );
  });

  describe('Cobro único por cita', () => {
    // Debería lanzar ConflictError si la cita ya tiene un pago manual completado
    it('should throw ConflictError when the appointment already has a completed manual payment', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([completedManualPayment()]);

      const result = createPayment.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toThrow(
        'This appointment already has a completed payment. A new payment cannot be registered.',
      );
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // Debería lanzar ConflictError si la cita ya se pagó por la pasarela
    it('should throw ConflictError when the appointment was already paid through the gateway', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        gatewayCheckout({ status: PaymentStatusEnum.COMPLETED }),
      ]);

      await expect(createPayment.execute(dto, adminId, 'ADMIN')).rejects.toThrow(
        'This appointment already has a completed payment',
      );
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // Debería lanzar ConflictError si la cita tiene un checkout de pasarela vigente
    it('should throw ConflictError when the appointment has an open gateway checkout', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        gatewayCheckout({ checkoutExpiresAt: minutesFromNow(30) }),
      ]);

      await expect(createPayment.execute(dto, adminId, 'ADMIN')).rejects.toThrow(
        'There is a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it, before registering a manual payment.',
      );
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // Debería registrar el pago si el pago anterior fue reembolsado
    it('should register the payment when the previous payment was refunded', async () => {
      const refunded = completedManualPayment();
      refunded.refund('Turno reprogramado');
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([refunded]);

      const result = await createPayment.execute(dto, adminId, 'ADMIN');

      expect(result.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.save).toHaveBeenCalledTimes(1);
    });

    // Debería registrar el pago si el checkout anterior de pasarela falló
    it('should register the payment when the previous gateway checkout failed', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        gatewayCheckout({ status: PaymentStatusEnum.FAILED }),
      ]);

      await createPayment.execute(dto, adminId, 'ADMIN');

      expect(mockPaymentRepository.save).toHaveBeenCalledTimes(1);
    });

    // Debería registrar el pago si la cita solo tiene otro pago manual pendiente
    it('should register the payment when the appointment only has another pending manual payment', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        Payment.create('pending-manual-id', 85, appointmentId),
      ]);

      await createPayment.execute(dto, adminId, 'ADMIN');

      expect(mockPaymentRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('Checkouts vencidos', () => {
    // Debería marcar FAILED un checkout vencido sin pago en la pasarela y registrar el pago
    it('should mark an expired checkout without a gateway payment as FAILED and register the payment', async () => {
      const expired = gatewayCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);

      await createPayment.execute(dto, adminId, 'ADMIN');

      expect(fakeGateway.findByExternalReferenceCalls).toEqual(['gateway-payment-id']);
      expect(expired.status).toBe(PaymentStatusEnum.FAILED);
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
      expect(mockPaymentRepository.save).toHaveBeenCalledTimes(1);
    });

    // Debería lanzar ConflictError si la pasarela tiene un pago aprobado para el checkout vencido
    it('should throw ConflictError when the gateway has an approved payment for the expired checkout', async () => {
      const expired = gatewayCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.paymentsByExternalReference.set('gateway-payment-id', {
        gatewayPaymentId: '181041671799',
        status: 'approved',
        externalReference: 'gateway-payment-id',
      });

      await expect(createPayment.execute(dto, adminId, 'ADMIN')).rejects.toThrow(
        'A new payment cannot be registered',
      );
      expect(expired.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // Debería responder 502 sin registrar el pago si la pasarela falla al revisar el checkout vencido
    it('should respond 502 without registering the payment when the gateway fails', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([gatewayCheckout()]);
      fakeGateway.findByExternalReferenceError = new PaymentGatewayError('HTTP 503', 503);

      await expect(createPayment.execute(dto, adminId, 'ADMIN')).rejects.toMatchObject({
        statusCode: 502,
      });
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('Orden de las validaciones', () => {
    // Debería rechazar por permisos antes de revisar los pagos de la cita
    it('should reject on permissions before looking at the appointment payments', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([completedManualPayment()]);

      await expect(createPayment.execute(dto, otherStylistId, 'STYLIST')).rejects.toThrow(
        ForbiddenError,
      );
      expect(mockPaymentRepository.findByAppointmentId).not.toHaveBeenCalled();
    });

    // Debería rechazar por el estado de la cita antes de revisar sus pagos
    it('should reject on the appointment status before looking at its payments', async () => {
      mockAppointmentStatusRepository.findById.mockResolvedValue({
        id: statusId,
        name: 'PENDING',
        description: '',
      } as any);
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([completedManualPayment()]);

      await expect(createPayment.execute(dto, adminId, 'ADMIN')).rejects.toThrow(BusinessRuleError);
      expect(mockPaymentRepository.findByAppointmentId).not.toHaveBeenCalled();
    });
  });
});
