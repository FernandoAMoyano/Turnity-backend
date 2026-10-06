import { CreateCheckout } from '../../../../../src/modules/payments/application/use-cases/CreateCheckout';
import { IGatewayAwarePaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentGatewayLookup';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentStatusRepository';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';
import {
  Payment,
  PaymentStatusEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';
import { ConflictError } from '../../../../../src/shared/exceptions/ConflictError';
import { ValidationError } from '../../../../../src/shared/exceptions/ValidationError';
import { AppError } from '../../../../../src/shared/exceptions/AppError';

describe('CreateCheckout Use Case', () => {
  let createCheckout: CreateCheckout;
  let mockPaymentRepository: jest.Mocked<IGatewayAwarePaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let mockAppointmentStatusRepository: jest.Mocked<IAppointmentStatusRepository>;
  let fakeGateway: FakePaymentGateway;

  const validAppointmentId = '123e4567-e89b-12d3-a456-426614174001';
  const validStatusId = '123e4567-e89b-12d3-a456-426614174002';
  const validStylistId = '123e4567-e89b-12d3-a456-426614174010';
  const validClientId = '123e4567-e89b-12d3-a456-426614174011';
  const validUserId = '123e4567-e89b-12d3-a456-426614174012';
  const otherPersonId = '123e4567-e89b-12d3-a456-426614174099';

  const mockAppointment = {
    id: validAppointmentId,
    statusId: validStatusId,
    stylistId: validStylistId,
    clientId: validClientId,
    userId: validUserId,
  };

  const mockConfirmedStatus = { id: validStatusId, name: 'CONFIRMED', description: '' };

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
      findByGatewayPaymentId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
    };

    mockAppointmentRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IAppointmentRepository>;

    mockAppointmentStatusRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IAppointmentStatusRepository>;

    fakeGateway = new FakePaymentGateway();

    mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);
    mockAppointmentStatusRepository.findById.mockResolvedValue(mockConfirmedStatus as any);
    mockPaymentRepository.findByAppointmentId.mockResolvedValue([]);
    mockPaymentRepository.findByIdempotencyKey.mockResolvedValue(null);
    mockPaymentRepository.save.mockImplementation(async (payment: Payment) => payment);
    mockPaymentRepository.update.mockImplementation(async (payment: Payment) => payment);

    createCheckout = new CreateCheckout(
      mockPaymentRepository,
      mockAppointmentRepository,
      mockAppointmentStatusRepository,
      fakeGateway,
    );
  });

  const dto = { appointmentId: validAppointmentId, amount: 1500.5 };

  // Debería crear un checkout exitosamente y devolver created: true
  it('should create a checkout successfully', async () => {
    const result = await createCheckout.execute(dto, otherPersonId, 'ADMIN');

    expect(result.created).toBe(true);
    expect(result.dto.checkoutUrl).toBe(fakeGateway.checkoutResult.checkoutUrl);
    expect(result.dto.gatewayPreferenceId).toBe(fakeGateway.checkoutResult.gatewayPreferenceId);
    expect(result.dto.status).toBe(PaymentStatusEnum.PENDING);
    expect(result.dto.provider).toBe(PaymentProviderEnum.MERCADO_PAGO);
    expect(mockPaymentRepository.save).toHaveBeenCalledTimes(1);
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
    expect(fakeGateway.createCheckoutCalls).toHaveLength(1);
  });

  // Debería generar una idempotencyKey cuando el DTO no trae una, y pasarla
  // igual al Payment que al gateway
  it('should generate an idempotencyKey when none is given', async () => {
    await createCheckout.execute(dto, otherPersonId, 'ADMIN');

    const [savedPayment] = mockPaymentRepository.save.mock.calls[0];
    expect(savedPayment.idempotencyKey).toBeDefined();
    expect(fakeGateway.createCheckoutCalls[0].idempotencyKey).toBe(savedPayment.idempotencyKey);
  });

  // Debería usar la description del DTO cuando se envía, y un default cuando no
  it('should default the description when not provided', async () => {
    await createCheckout.execute(dto, otherPersonId, 'ADMIN');

    expect(fakeGateway.createCheckoutCalls[0].description).toContain(validAppointmentId);
  });

  // Debería usar la description del DTO cuando se envía explícitamente
  it('should use the given description when provided', async () => {
    await createCheckout.execute(
      { ...dto, description: 'Corte + color' },
      otherPersonId,
      'ADMIN',
    );

    expect(fakeGateway.createCheckoutCalls[0].description).toBe('Corte + color');
  });

  // Debería lanzar ValidationError si el monto no es positivo
  it('should throw ValidationError if amount is 0', async () => {
    await expect(
      createCheckout.execute({ ...dto, amount: 0 }, otherPersonId, 'ADMIN'),
    ).rejects.toThrow(ValidationError);
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
  });

  // Debería lanzar NotFoundError si la cita no existe
  it('should throw NotFoundError when appointment does not exist', async () => {
    mockAppointmentRepository.findById.mockResolvedValue(null);

    await expect(createCheckout.execute(dto, otherPersonId, 'ADMIN')).rejects.toThrow(
      NotFoundError,
    );
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si la cita no está CONFIRMED/COMPLETED
  it('should throw BusinessRuleError when appointment is PENDING', async () => {
    mockAppointmentStatusRepository.findById.mockResolvedValue({
      id: validStatusId,
      name: 'PENDING',
      description: '',
    } as any);

    await expect(createCheckout.execute(dto, otherPersonId, 'ADMIN')).rejects.toThrow(
      BusinessRuleError,
    );
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
  });

  // Debería permitir checkout sobre una cita COMPLETED (pago posterior)
  it('should allow checkout for a COMPLETED appointment', async () => {
    mockAppointmentStatusRepository.findById.mockResolvedValue({
      id: validStatusId,
      name: 'COMPLETED',
      description: '',
    } as any);

    const result = await createCheckout.execute(dto, otherPersonId, 'ADMIN');

    expect(result.created).toBe(true);
  });

  describe('D1: ownership (ADMIN / STYLIST dueño / CLIENT dueño)', () => {
    // Debería permitir a ADMIN sin importar el ownership de la cita
    it('should allow ADMIN regardless of ownership', async () => {
      const result = await createCheckout.execute(dto, otherPersonId, 'ADMIN');
      expect(result.created).toBe(true);
    });

    // Debería permitir al STYLIST asignado a la cita
    it('should allow the assigned STYLIST', async () => {
      const result = await createCheckout.execute(dto, validStylistId, 'STYLIST');
      expect(result.created).toBe(true);
    });

    // Debería rechazar a un STYLIST que no es el asignado a la cita
    it('should reject a STYLIST who is not assigned to the appointment', async () => {
      await expect(
        createCheckout.execute(dto, otherPersonId, 'STYLIST'),
      ).rejects.toThrow(ForbiddenError);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // Debería permitir al CLIENT dueño de la cita (clientId)
    it('should allow the CLIENT who owns the appointment (clientId)', async () => {
      const result = await createCheckout.execute(dto, validClientId, 'CLIENT');
      expect(result.created).toBe(true);
    });

    // Debería permitir al CLIENT que creó la cita (userId)
    it('should allow the CLIENT who created the appointment (userId)', async () => {
      const result = await createCheckout.execute(dto, validUserId, 'CLIENT');
      expect(result.created).toBe(true);
    });

    // Debería rechazar a un CLIENT que no es dueño de la cita
    it('should reject a CLIENT who does not own the appointment', async () => {
      await expect(
        createCheckout.execute(dto, otherPersonId, 'CLIENT'),
      ).rejects.toThrow(ForbiddenError);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('Idempotencia saliente', () => {
    // Debería devolver el checkout existente sin llamar a la pasarela cuando la idempotencyKey coincide
    it('should return the existing checkout without calling the gateway when idempotencyKey matches', async () => {
      const existingPayment = Payment.createForGateway(
        'existing-payment-id',
        1500.5,
        validAppointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        'repeated-key',
      );
      existingPayment.recordCheckoutCreated('https://example.com/checkout', 'existing-pref');
      mockPaymentRepository.findByIdempotencyKey.mockResolvedValue(existingPayment);

      const result = await createCheckout.execute(
        { ...dto, idempotencyKey: 'repeated-key' },
        otherPersonId,
        'ADMIN',
      );

      expect(result.created).toBe(false);
      expect(result.dto.paymentId).toBe('existing-payment-id');
      expect(result.dto.checkoutUrl).toBe('https://example.com/checkout');
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Recuperación: un intento anterior con la misma Idempotency-Key se
    // cortó entre save() y update() y dejó el Payment PENDING sin
    // checkoutUrl. El siguiente intento con la misma clave debe reintentar
    // la llamada a la pasarela sobre ESE mismo Payment, no crear uno nuevo
    // (violaría el @unique de idempotencyKey) ni devolver una respuesta con
    // checkoutUrl indefinido.
    it('should retry the gateway call on the same payment when a previous attempt was interrupted before recording the checkout', async () => {
      const staleP = Payment.createForGateway(
        'stale-payment-id',
        1500.5,
        validAppointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        'repeated-key',
      );
      mockPaymentRepository.findByIdempotencyKey.mockResolvedValue(staleP);

      const result = await createCheckout.execute(
        { ...dto, idempotencyKey: 'repeated-key' },
        otherPersonId,
        'ADMIN',
      );

      expect(result.created).toBe(true);
      expect(result.dto.paymentId).toBe('stale-payment-id');
      expect(result.dto.checkoutUrl).toBe(fakeGateway.checkoutResult.checkoutUrl);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(1);
      expect(fakeGateway.createCheckoutCalls[0].idempotencyKey).toBe('repeated-key');
    });
  });

  describe('D5: un solo checkout PENDING por cita (409)', () => {
    // Debería lanzar ConflictError si ya hay un Payment PENDING respaldado por la pasarela para la misma cita
    it('should throw ConflictError when a gateway-backed PENDING payment already exists for the appointment', async () => {
      const openCheckout = Payment.createForGateway(
        'other-payment-id',
        1000,
        validAppointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        'other-key',
      );
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([openCheckout]);

      await expect(createCheckout.execute(dto, otherPersonId, 'ADMIN')).rejects.toThrow(
        ConflictError,
      );
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // No debería generar conflicto con un pago MANUAL sobre la misma cita
    it('should not conflict with a MANUAL payment on the same appointment', async () => {
      const manualPayment = Payment.create('manual-payment-id', 1000, validAppointmentId);
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([manualPayment]);

      const result = await createCheckout.execute(dto, otherPersonId, 'ADMIN');

      expect(result.created).toBe(true);
    });

    // No debería generar conflicto con un pago de pasarela ya resuelto (COMPLETED)
    it('should not conflict with a gateway-backed payment that is already resolved (COMPLETED)', async () => {
      const resolvedPayment = Payment.createForGateway(
        'resolved-payment-id',
        1000,
        validAppointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        'resolved-key',
      );
      resolvedPayment.applyGatewayStatus({
        status: PaymentStatusEnum.COMPLETED,
        gatewayStatus: 'approved',
      });
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([resolvedPayment]);

      const result = await createCheckout.execute(dto, otherPersonId, 'ADMIN');

      expect(result.created).toBe(true);
    });
  });

  describe('Fallo de la pasarela', () => {
    // Debería marcar el pago FAILED y relanzar como 502 cuando la pasarela lanza un error genérico
    it('should mark the payment FAILED and rethrow as a 502 when the gateway throws a generic error', async () => {
      fakeGateway.createCheckoutError = new Error('Network timeout');

      await expect(createCheckout.execute(dto, otherPersonId, 'ADMIN')).rejects.toMatchObject({
        statusCode: 502,
        code: 'BUSINESS_RULE_ERROR',
      });

      expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
      const [failedPayment] = mockPaymentRepository.update.mock.calls[0];
      expect(failedPayment.status).toBe(PaymentStatusEnum.FAILED);
      expect(failedPayment.failureReason).toBe('Network timeout');
    });

    // Debería marcar el pago FAILED y relanzar tal cual cuando la pasarela no está configurada
    it('should mark the payment FAILED and rethrow as-is when the gateway is not configured', async () => {
      fakeGateway.createCheckoutError = new BusinessRuleError('Payment gateway is not configured');

      await expect(createCheckout.execute(dto, otherPersonId, 'ADMIN')).rejects.toMatchObject({
        statusCode: 422,
        code: 'BUSINESS_RULE_ERROR',
        message: 'Payment gateway is not configured',
      });

      const [failedPayment] = mockPaymentRepository.update.mock.calls[0];
      expect(failedPayment.status).toBe(PaymentStatusEnum.FAILED);
      expect(failedPayment.failureReason).toBe('Payment gateway is not configured');
    });

    // Debería seguir lanzando un AppError aunque el rechazo no sea una instancia de Error
    it('should still throw an AppError even for a non-Error rejection', async () => {
      fakeGateway.createCheckout = jest.fn().mockRejectedValue('plain string rejection');

      await expect(
        createCheckout.execute(dto, otherPersonId, 'ADMIN'),
      ).rejects.toBeInstanceOf(AppError);
    });
  });
});
