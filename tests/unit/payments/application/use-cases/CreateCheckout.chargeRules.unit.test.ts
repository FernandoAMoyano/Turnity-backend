import { CreateCheckout } from '../../../../../src/modules/payments/application/use-cases/CreateCheckout';
import { IGatewayAwarePaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentGatewayLookup';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentStatusRepository';
import { IServiceRepository } from '../../../../../src/modules/services/domain/repositories/IServiceRepository';
import { IStylistServiceRepository } from '../../../../../src/modules/services/domain/repositories/IStylistServiceRepository';
import { Service } from '../../../../../src/modules/services/domain/entities/Service';
import { StylistService } from '../../../../../src/modules/services/domain/entities/StylistService';
import { PaymentGatewayError } from '../../../../../src/modules/payments/domain/gateways/PaymentGatewayError';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';
import {
  Payment,
  PaymentProps,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ConflictError } from '../../../../../src/shared/exceptions/ConflictError';

describe('CreateCheckout Use Case - Reglas de cobro', () => {
  let createCheckout: CreateCheckout;
  let mockPaymentRepository: jest.Mocked<IGatewayAwarePaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let mockAppointmentStatusRepository: jest.Mocked<IAppointmentStatusRepository>;
  let mockServiceRepository: jest.Mocked<IServiceRepository>;
  let mockStylistServiceRepository: jest.Mocked<IStylistServiceRepository>;
  let fakeGateway: FakePaymentGateway;

  const appointmentId = '123e4567-e89b-12d3-a456-426614174001';
  const statusId = '123e4567-e89b-12d3-a456-426614174002';
  const stylistId = '123e4567-e89b-12d3-a456-426614174010';
  const categoryId = '123e4567-e89b-12d3-a456-426614174020';
  const adminId = '123e4567-e89b-12d3-a456-426614174099';

  const haircut = new Service(
    '123e4567-e89b-12d3-a456-426614174031',
    categoryId,
    'Corte',
    'Corte de pelo',
    30,
    0,
    2500,
  );
  const coloring = new Service(
    '123e4567-e89b-12d3-a456-426614174032',
    categoryId,
    'Color',
    'Coloración completa',
    90,
    0,
    6000,
  );

  const baseAppointment = {
    id: appointmentId,
    statusId,
    stylistId,
    clientId: '123e4567-e89b-12d3-a456-426614174011',
    userId: '123e4567-e89b-12d3-a456-426614174011',
    serviceIds: [haircut.id, coloring.id],
  };

  const dto = { appointmentId };

  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

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

    mockAppointmentRepository.findById.mockResolvedValue(baseAppointment as any);
    mockAppointmentStatusRepository.findById.mockResolvedValue({
      id: statusId,
      name: 'CONFIRMED',
      description: '',
    } as any);
    mockServiceRepository.findById.mockImplementation(
      async (id: string) => [haircut, coloring].find((service) => service.id === id) ?? null,
    );
    mockStylistServiceRepository.findByStylist.mockResolvedValue([]);
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
    );
  });

  describe('Monto calculado por el servidor', () => {
    // Debería cobrar la suma de los precios base convertida a la unidad monetaria base
    it('should charge the sum of the base prices in the base currency unit', async () => {
      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(fakeGateway.createCheckoutCalls[0].amount).toBe(85);
      expect(mockPaymentRepository.save.mock.calls[0][0].amount).toBe(85);
      expect(result.dto.amount).toBe(85);
    });

    // Debería usar el precio propio del estilista de la cita
    it('should use the custom price of the appointment stylist', async () => {
      mockStylistServiceRepository.findByStylist.mockResolvedValue([
        new StylistService(stylistId, coloring.id, 7000),
      ]);

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(mockStylistServiceRepository.findByStylist).toHaveBeenCalledWith(stylistId);
      expect(result.dto.amount).toBe(95);
    });

    // Debería usar los precios base sin consultar asignaciones si la cita no tiene estilista
    it('should use the base prices without looking up assignments when there is no stylist', async () => {
      mockAppointmentRepository.findById.mockResolvedValue({
        ...baseAppointment,
        stylistId: undefined,
      } as any);

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(mockStylistServiceRepository.findByStylist).not.toHaveBeenCalled();
      expect(result.dto.amount).toBe(85);
    });

    // Debería lanzar BusinessRuleError si la cita no tiene servicios que cobrar
    it('should throw BusinessRuleError when the appointment has no services to charge', async () => {
      mockAppointmentRepository.findById.mockResolvedValue({
        ...baseAppointment,
        serviceIds: [],
      } as any);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toThrow(
        BusinessRuleError,
      );
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Debería lanzar NotFoundError si uno de los servicios de la cita no existe
    it('should throw NotFoundError when one of the appointment services does not exist', async () => {
      mockServiceRepository.findById.mockResolvedValueOnce(haircut).mockResolvedValueOnce(null);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toThrow(NotFoundError);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // Debería guardar y devolver el vencimiento informado por la pasarela
    it('should store and return the expiration reported by the gateway', async () => {
      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      const [updatedPayment] = mockPaymentRepository.update.mock.calls[0];
      expect(updatedPayment.checkoutExpiresAt).toEqual(fakeGateway.checkoutResult.expiresAt);
      expect(result.dto.expiresAt).toEqual(fakeGateway.checkoutResult.expiresAt);
    });
  });

  describe('Cobro único por cita', () => {
    // Debería lanzar ConflictError si la cita ya tiene un pago manual completado
    it('should throw ConflictError when the appointment already has a completed manual payment', async () => {
      const manualPayment = Payment.create('manual-payment-id', 85, appointmentId);
      manualPayment.markAsCompleted(PaymentMethodEnum.CASH);
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([manualPayment]);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toThrow(
        'This appointment already has a completed payment',
      );
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(fakeGateway.createCheckoutCalls).toHaveLength(0);
    });

    // Debería permitir el checkout si el pago anterior fue reembolsado
    it('should allow a checkout when the previous payment was refunded', async () => {
      const refundedPayment = Payment.create('refunded-payment-id', 85, appointmentId);
      refundedPayment.markAsCompleted(PaymentMethodEnum.CASH);
      refundedPayment.refund('Turno reprogramado');
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([refundedPayment]);

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(result.created).toBe(true);
    });

    // Debería permitir el checkout si el checkout anterior de pasarela falló
    it('should allow a checkout when the previous gateway checkout failed', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        expiredCheckout({ status: PaymentStatusEnum.FAILED }),
      ]);

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(result.created).toBe(true);
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
    });
  });

  describe('Checkouts vencidos', () => {
    // Debería marcar FAILED un checkout vencido sin pago en la pasarela y abrir uno nuevo
    it('should mark an expired checkout without a gateway payment as FAILED and open a new one', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(fakeGateway.findByExternalReferenceCalls).toEqual(['expired-payment-id']);
      expect(expired.status).toBe(PaymentStatusEnum.FAILED);
      expect(expired.failureReason).toBe(
        'Checkout expired without a payment at the payment gateway',
      );
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
      expect(result.created).toBe(true);
      expect(result.dto.paymentId).not.toBe('expired-payment-id');
    });

    // Debería completar el pago y lanzar ConflictError si la pasarela tiene un pago aprobado
    it('should complete the payment and throw ConflictError when the gateway has an approved payment', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.paymentsByExternalReference.set('expired-payment-id', {
        gatewayPaymentId: '181041671799',
        status: 'approved',
        externalReference: 'expired-payment-id',
      });

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toThrow(
        'This appointment already has a completed payment',
      );
      expect(expired.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(expired.gatewayPaymentId).toBe('181041671799');
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // Debería mantener el bloqueo si la pasarela tiene un pago todavía en proceso
    it('should keep blocking when the gateway has a payment still in process', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.paymentsByExternalReference.set('expired-payment-id', {
        gatewayPaymentId: '181041671799',
        status: 'in_process',
      });

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toThrow(
        'There is already a pending checkout for this appointment',
      );
      expect(expired.status).toBe(PaymentStatusEnum.PENDING);
      expect(expired.gatewayStatus).toBe('in_process');
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(expired);
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
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

      const result = await createCheckout.execute(dto, adminId, 'ADMIN');

      expect(fakeGateway.getPaymentCalls).toEqual(['181041671799']);
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
      expect(expired.status).toBe(PaymentStatusEnum.FAILED);
      expect(result.created).toBe(true);
    });

    // No debería liberar el checkout si la pasarela falla al revisarlo
    it('should not release the checkout when the gateway fails while checking it', async () => {
      const expired = expiredCheckout();
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([expired]);
      fakeGateway.findByExternalReferenceError = new PaymentGatewayError('HTTP 503', 503);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toMatchObject({
        statusCode: 502,
        message:
          'The payment gateway did not respond while checking an expired checkout for this appointment. Please try again later.',
      });
      expect(expired.status).toBe(PaymentStatusEnum.PENDING);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    // No debería consultar a la pasarela mientras no pase el margen de espera
    it('should not check with the gateway before the grace period is over', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue([
        expiredCheckout({ checkoutExpiresAt: minutesAgo(2) }),
      ]);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toThrow(ConflictError);
      expect(fakeGateway.findByExternalReferenceCalls).toHaveLength(0);
      expect(fakeGateway.getPaymentCalls).toHaveLength(0);
    });
  });

  describe('Fallo de la pasarela al crear el checkout', () => {
    // Debería responder 502 con el mensaje de credenciales ante un 401 del proveedor
    it('should respond 502 with the credentials message on a provider 401', async () => {
      fakeGateway.createCheckoutError = new PaymentGatewayError('HTTP 401', 401);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toMatchObject({
        statusCode: 502,
        message:
          'The payment gateway rejected the credentials configured on this server. Check the payment gateway configuration.',
      });
    });

    // Debería responder 502 sin invitar a reintentar ante otro 4xx del proveedor
    it('should respond 502 without suggesting a retry on another provider 4xx', async () => {
      fakeGateway.createCheckoutError = new PaymentGatewayError('HTTP 400', 400);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toMatchObject({
        statusCode: 502,
        message: 'The payment gateway rejected the checkout creation.',
      });
    });

    // Debería responder 502 invitando a reintentar ante un 5xx del proveedor
    it('should respond 502 suggesting a retry on a provider 5xx', async () => {
      fakeGateway.createCheckoutError = new PaymentGatewayError('HTTP 503', 503);

      await expect(createCheckout.execute(dto, adminId, 'ADMIN')).rejects.toMatchObject({
        statusCode: 502,
        message: 'The payment gateway rejected the checkout creation. Please try again later.',
      });
    });
  });
});
