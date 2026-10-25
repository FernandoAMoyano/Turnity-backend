import {
  AppointmentChargeGuard,
  ChargeConflictMessages,
} from '../../../../../src/modules/payments/application/services/AppointmentChargeGuard';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { PaymentGatewayError } from '../../../../../src/modules/payments/domain/gateways/PaymentGatewayError';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';
import {
  Payment,
  PaymentProps,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import { ConflictError } from '../../../../../src/shared/exceptions/ConflictError';

describe('AppointmentChargeGuard', () => {
  let guard: AppointmentChargeGuard;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let fakeGateway: FakePaymentGateway;

  const appointmentId = '123e4567-e89b-12d3-a456-426614174001';

  const messages: ChargeConflictMessages = {
    alreadyPaid: 'Already paid message from the caller',
    openCheckout: 'Open checkout message from the caller',
  };

  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);
  const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

  /**
   * Pago de pasarela PENDING cuyo checkout venció hace una hora
   */
  const expiredCheckout = (overrides: Partial<PaymentProps> = {}): Payment =>
    new Payment({
      id: 'expired-payment-id',
      amount: 85,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId,
      provider: PaymentProviderEnum.MERCADO_PAGO,
      idempotencyKey: 'expired-key',
      checkoutUrl: 'https://checkout.example/expired',
      gatewayPreferenceId: 'expired-preference-id',
      checkoutExpiresAt: minutesAgo(60),
      createdAt: minutesAgo(90),
      updatedAt: minutesAgo(90),
      ...overrides,
    });

  const completedManualPayment = (): Payment => {
    const payment = Payment.create('manual-payment-id', 85, appointmentId);
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

    fakeGateway = new FakePaymentGateway();

    mockPaymentRepository.findByAppointmentId.mockResolvedValue([]);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    guard = new AppointmentChargeGuard(mockPaymentRepository, fakeGateway);
  });

  describe('Citas que pueden cobrarse', () => {
    // Debería permitir el cobro si la cita no tiene pagos
    it('should allow the charge when the appointment has no payments', async () => {
      await expect(
        guard.ensureAppointmentIsChargeable(appointmentId, messages),
      ).resolves.toBeUndefined();
      expect(mockPaymentRepository.findByAppointmentId).toHaveBeenCalledWith(appointmentId);
    });

    // Debería permitir el cobro si el único pago fue reembolsado
    it('should allow the charge when the only payment was refunded', async () => {
      const refunded = completedManualPayment();
      refunded.refund('Turno reprogramado');
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([refunded]);

      await expect(
        guard.ensureAppointmentIsChargeable(appointmentId, messages),
      ).resolves.toBeUndefined();
    });

    // Debería permitir el cobro si el único checkout de pasarela falló
    it('should allow the charge when the only gateway checkout failed', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        expiredCheckout({ status: PaymentStatusEnum.FAILED }),
      ]);

      await expect(
        guard.ensureAppointmentIsChargeable(appointmentId, messages),
      ).resolves.toBeUndefined();
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
    });

    // Debería permitir el cobro si solo hay un pago manual pendiente
    it('should allow the charge when there is only a pending manual payment', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        Payment.create('manual-pending-id', 85, appointmentId),
      ]);

      await expect(
        guard.ensureAppointmentIsChargeable(appointmentId, messages),
      ).resolves.toBeUndefined();
    });
  });

  describe('Citas que no pueden cobrarse', () => {
    // Debería lanzar ConflictError con el mensaje del caller si la cita tiene un pago manual completado
    it('should throw ConflictError with the caller message when there is a completed manual payment', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([completedManualPayment()]);

      const result = guard.ensureAppointmentIsChargeable(appointmentId, messages);

      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toThrow(messages.alreadyPaid);
    });

    // Debería lanzar ConflictError con el mensaje del caller si la cita tiene un pago de pasarela completado
    it('should throw ConflictError with the caller message when there is a completed gateway payment', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        expiredCheckout({ status: PaymentStatusEnum.COMPLETED }),
      ]);

      await expect(guard.ensureAppointmentIsChargeable(appointmentId, messages)).rejects.toThrow(
        messages.alreadyPaid,
      );
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
    });

    // Debería lanzar ConflictError con el mensaje del caller si hay un checkout vigente
    it('should throw ConflictError with the caller message when a checkout is still open', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        expiredCheckout({ checkoutExpiresAt: minutesFromNow(30) }),
      ]);

      const result = guard.ensureAppointmentIsChargeable(appointmentId, messages);

      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toThrow(messages.openCheckout);
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('Checkouts vencidos', () => {
    // Debería marcar FAILED un checkout vencido sin pago en la pasarela y permitir el cobro
    it('should mark an expired checkout without a gateway payment as FAILED and allow the charge', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);

      await expect(
        guard.ensureAppointmentIsChargeable(appointmentId, messages),
      ).resolves.toBeUndefined();
      expect(fakeGateway.findByExternalReferenceCalls).toEqual(['expired-payment-id']);
      expect(expired.status).toBe(PaymentStatusEnum.FAILED);
      expect(expired.failureReason).toBe(
        'Checkout expired without a payment at the payment gateway',
      );
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
    });

    // Debería completar el pago y lanzar el mensaje de cita pagada si la pasarela lo aprobó
    it('should complete the payment and throw the already paid message when the gateway approved it', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.paymentsByExternalReference.set('expired-payment-id', {
        gatewayPaymentId: '181041671799',
        status: 'approved',
        externalReference: 'expired-payment-id',
      });

      await expect(guard.ensureAppointmentIsChargeable(appointmentId, messages)).rejects.toThrow(
        messages.alreadyPaid,
      );
      expect(expired.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
    });

    // Debería lanzar el mensaje de checkout abierto si la pasarela tiene el pago en proceso
    it('should throw the open checkout message when the gateway payment is still in process', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.paymentsByExternalReference.set('expired-payment-id', {
        gatewayPaymentId: '181041671799',
        status: 'in_process',
      });

      await expect(guard.ensureAppointmentIsChargeable(appointmentId, messages)).rejects.toThrow(
        messages.openCheckout,
      );
      expect(expired.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
    });

    // Debería consultar por identificador cuando el pago local ya lo tiene
    it('should look up by gateway payment id when the local payment already has one', async () => {
      const expired = expiredCheckout({ gatewayPaymentId: '181041671799' });
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.paymentSnapshots.set('181041671799', {
        gatewayPaymentId: '181041671799',
        status: 'rejected',
        statusDetail: 'cc_rejected_insufficient_amount',
      });

      await expect(
        guard.ensureAppointmentIsChargeable(appointmentId, messages),
      ).resolves.toBeUndefined();
      expect(fakeGateway.getPaymentCalls).toEqual(['181041671799']);
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
      expect(expired.status).toBe(PaymentStatusEnum.FAILED);
    });

    // Debería responder 502 sin tocar el pago local si la pasarela falla al revisarlo
    it('should respond 502 without touching the local payment when the gateway fails', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.findByExternalReferenceError = new PaymentGatewayError('HTTP 503', 503);

      await expect(
        guard.ensureAppointmentIsChargeable(appointmentId, messages),
      ).rejects.toMatchObject({
        statusCode: 502,
        message:
          'The payment gateway did not respond while checking an expired checkout for this appointment. Please try again later.',
      });
      expect(expired.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });
  });
});
