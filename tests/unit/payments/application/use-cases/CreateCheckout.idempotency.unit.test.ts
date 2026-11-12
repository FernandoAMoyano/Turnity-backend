import { CreateCheckout } from '../../../../../src/modules/payments/application/use-cases/CreateCheckout';
import { AppointmentChargeGuard } from '../../../../../src/modules/payments/application/services/AppointmentChargeGuard';
import { IGatewayAwarePaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentGatewayLookup';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentStatusRepository';
import { IServiceRepository } from '../../../../../src/modules/services/domain/repositories/IServiceRepository';
import { IStylistServiceRepository } from '../../../../../src/modules/services/domain/repositories/IStylistServiceRepository';
import { Service } from '../../../../../src/modules/services/domain/entities/Service';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';
import {
  Payment,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import { DuplicateIdempotencyKeyError } from '../../../../../src/modules/payments/domain/errors/DuplicateIdempotencyKeyError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ConflictError } from '../../../../../src/shared/exceptions/ConflictError';

describe('CreateCheckout Use Case - Idempotency-Key rules', () => {
  let createCheckout: CreateCheckout;
  let mockPaymentRepository: jest.Mocked<IGatewayAwarePaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let mockAppointmentStatusRepository: jest.Mocked<IAppointmentStatusRepository>;
  let mockServiceRepository: jest.Mocked<IServiceRepository>;
  let mockStylistServiceRepository: jest.Mocked<IStylistServiceRepository>;
  let fakeGateway: FakePaymentGateway;

  const validAppointmentId = '123e4567-e89b-12d3-a456-426614174001';
  const otherAppointmentId = '123e4567-e89b-12d3-a456-426614174003';
  const validStatusId = '123e4567-e89b-12d3-a456-426614174002';
  const validStylistId = '123e4567-e89b-12d3-a456-426614174010';
  const validClientId = '123e4567-e89b-12d3-a456-426614174011';
  const validUserId = '123e4567-e89b-12d3-a456-426614174012';
  const adminId = '123e4567-e89b-12d3-a456-426614174099';
  const repeatedKey = '123e4567-e89b-12d3-a456-426614174777';

  const mockService = new Service(
    '123e4567-e89b-12d3-a456-426614174020',
    '123e4567-e89b-12d3-a456-426614174021',
    'Corte',
    'Corte de pelo',
    30,
    0,
    150050,
  );

  const mockAppointment = {
    id: validAppointmentId,
    statusId: validStatusId,
    stylistId: validStylistId,
    clientId: validClientId,
    userId: validUserId,
    serviceIds: [mockService.id],
  };

  const mockConfirmedStatus = { id: validStatusId, name: 'CONFIRMED', description: '' };

  const dto = { appointmentId: validAppointmentId, idempotencyKey: repeatedKey };

  const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

  /**
   * Pago de pasarela PENDING con la clave repetida, sin checkout anotado
   */
  const gatewayPaymentWithKey = (appointmentId = validAppointmentId): Payment =>
    Payment.createForGateway(
      'key-payment-id',
      1500.5,
      appointmentId,
      PaymentProviderEnum.MERCADO_PAGO,
      repeatedKey,
    );

  /**
   * Pago de pasarela PENDING con la clave repetida y el checkout ya anotado
   */
  const recordedCheckoutWithKey = (appointmentId = validAppointmentId): Payment => {
    const payment = gatewayPaymentWithKey(appointmentId);
    payment.recordCheckoutCreated(
      'https://example.com/checkout/winner',
      'winner-preference',
      minutesFromNow(30),
    );
    return payment;
  };

  /**
   * Pago de pasarela con la clave repetida cuyo checkout falló al crearse
   */
  const failedCheckoutWithKey = (): Payment => {
    const payment = gatewayPaymentWithKey();
    payment.markAsFailed('The payment gateway rejected the checkout creation.');
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
      findByGatewayPaymentId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
    };

    mockAppointmentRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IAppointmentRepository>;

    mockAppointmentStatusRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IAppointmentStatusRepository>;

    mockServiceRepository = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      findActive: jest.fn(),
      findByCategory: jest.fn(),
      findActiveByCategoryId: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      existsById: jest.fn(),
      existsByName: jest.fn(),
    };

    mockStylistServiceRepository = {
      findByStylistAndService: jest.fn(),
      findByStylist: jest.fn(),
      findByService: jest.fn(),
      findActiveOfferings: jest.fn(),
      findStylistsOfferingService: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      existsAssignment: jest.fn(),
    };

    fakeGateway = new FakePaymentGateway();

    mockServiceRepository.findById.mockResolvedValue(mockService);
    mockStylistServiceRepository.findByStylist.mockResolvedValue([]);
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
      mockServiceRepository,
      mockStylistServiceRepository,
      new AppointmentChargeGuard(mockPaymentRepository, fakeGateway),
    );
  });

  describe('Key already used', () => {
    // Debería rechazar con 422 una clave usada para otra cita, sin devolver el checkout de esa cita
    it('should reject a key already used for another appointment without returning its checkout', async () => {
      mockPaymentRepository.findByIdempotencyKey.mockResolvedValue(
        recordedCheckoutWithKey(otherAppointmentId),
      );

      const result = createCheckout.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(result).rejects.toThrow(
        'This Idempotency-Key was already used for another appointment. Use a new key.',
      );
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Debería rechazar con 422 una clave cuyo checkout falló al crearse, sin volver a llamar a la pasarela
    it('should reject a key whose checkout failed to be created without calling the gateway again', async () => {
      mockPaymentRepository.findByIdempotencyKey.mockResolvedValue(failedCheckoutWithKey());

      const result = createCheckout.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(result).rejects.toThrow(
        'This Idempotency-Key belongs to a checkout that could not be created. Use a new key to try again.',
      );
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Debería responder 502 sin lanzar un error interno si la pasarela vuelve a fallar al retomar un checkout cortado
    it('should respond 502 when the gateway fails again while resuming an interrupted checkout', async () => {
      const interrupted = gatewayPaymentWithKey();
      mockPaymentRepository.findByIdempotencyKey.mockResolvedValue(interrupted);
      fakeGateway.createCheckoutError = new Error('Gateway down');

      const result = createCheckout.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toMatchObject({ statusCode: 502 });
      expect(interrupted.isFailed).toBe(true);
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(interrupted);
    });
  });

  describe('Concurrent requests with the same key', () => {
    // Debería devolver el checkout del pedido que guardó primero cuando el alta choca con la clave duplicada
    it('should return the checkout of the request that saved first when saving hits the duplicate key', async () => {
      mockPaymentRepository.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(recordedCheckoutWithKey());
      mockPaymentRepository.save.mockRejectedValue(new DuplicateIdempotencyKeyError());

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(result.created).toBe(false);
      expect(result.dto.paymentId).toBe('key-payment-id');
      expect(result.dto.checkoutUrl).toBe('https://example.com/checkout/winner');
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Debería devolver el checkout del pedido que guardó primero cuando el cobro único ya lo ve abierto
    it('should return the checkout of the request that saved first when the charge rule already sees it open', async () => {
      const winner = recordedCheckoutWithKey();
      mockPaymentRepository.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([winner]);

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(result.created).toBe(false);
      expect(result.dto.paymentId).toBe('key-payment-id');
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Debería responder 409 mientras el pedido que guardó primero todavía crea el checkout
    it('should respond 409 while the request that saved first is still creating the checkout', async () => {
      mockPaymentRepository.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(gatewayPaymentWithKey());
      mockPaymentRepository.save.mockRejectedValue(new DuplicateIdempotencyKeyError());

      const result = createCheckout.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toThrow(
        'A checkout with this Idempotency-Key is still being created. Retry the request in a few seconds.',
      );
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Debería responder 422 si el checkout del pedido que guardó primero falló al crearse
    it('should respond 422 when the checkout of the request that saved first failed to be created', async () => {
      mockPaymentRepository.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(failedCheckoutWithKey());
      mockPaymentRepository.save.mockRejectedValue(new DuplicateIdempotencyKeyError());

      const result = createCheckout.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(result).rejects.toThrow(
        'This Idempotency-Key belongs to a checkout that could not be created. Use a new key to try again.',
      );
    });

    // Debería responder 422 si el pedido que guardó primero usó la clave para otra cita
    it('should respond 422 when the request that saved first used the key for another appointment', async () => {
      mockPaymentRepository.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(recordedCheckoutWithKey(otherAppointmentId));
      mockPaymentRepository.save.mockRejectedValue(new DuplicateIdempotencyKeyError());

      const result = createCheckout.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(result).rejects.toThrow(
        'This Idempotency-Key was already used for another appointment. Use a new key.',
      );
    });
  });

  describe('Conflicts unrelated to the key', () => {
    // Debería mantener el 409 de checkout abierto si ningún pago tiene la clave del pedido
    it('should keep the open checkout conflict when no payment has the request key', async () => {
      const otherCheckout = Payment.createForGateway(
        'other-payment-id',
        1000,
        validAppointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        'other-key',
      );
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([otherCheckout]);

      const result = createCheckout.execute(dto, adminId, 'ADMIN');

      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toThrow(
        'There is already a pending checkout for this appointment',
      );
      expect(mockPaymentRepository.findByIdempotencyKey).toHaveBeenCalledTimes(2);
    });

    // Debería propagar sin tocar un error del alta que no es un conflicto
    it('should propagate a saving error that is not a conflict without looking up the key again', async () => {
      const databaseError = new Error('Connection lost');
      mockPaymentRepository.save.mockRejectedValue(databaseError);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toBe(databaseError);
      expect(mockPaymentRepository.findByIdempotencyKey).toHaveBeenCalledTimes(1);
    });

    // Debería propagar el conflicto sin buscar por clave cuando el pedido no trae una
    it('should propagate the conflict without a key lookup when the request has no key', async () => {
      mockPaymentRepository.save.mockRejectedValue(new DuplicateIdempotencyKeyError());

      const result = createCheckout.execute(
        { appointmentId: validAppointmentId },
        adminId,
        'ADMIN',
      );

      await expect(result).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
      expect(mockPaymentRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    });
  });
});
