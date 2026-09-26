import { SyncPaymentWithGateway } from '../../../../../src/modules/payments/application/use-cases/SyncPaymentWithGateway';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import {
  Payment,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';

describe('SyncPaymentWithGateway Use Case', () => {
  let syncPayment: SyncPaymentWithGateway;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let fakeGateway: FakePaymentGateway;

  const validAppointmentId = '123e4567-e89b-12d3-a456-426614174001';
  const gatewayPaymentId = 'MP-987654';

  /**
   * Arma un pago respaldado por pasarela en el estado indicado
   * @param status - Estado interno del pago
   * @param withGatewayId - Si el pago ya tiene identificador en la pasarela
   */
  const buildGatewayPayment = (status: PaymentStatusEnum, withGatewayId = true): Payment =>
    new Payment({
      id: '123e4567-e89b-12d3-a456-426614174090',
      amount: 200.0,
      status,
      method: status === PaymentStatusEnum.PENDING ? null : PaymentMethodEnum.ONLINE,
      paymentDate: status === PaymentStatusEnum.PENDING ? null : new Date(),
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
      provider: PaymentProviderEnum.MERCADO_PAGO,
      idempotencyKey: 'gateway-idempotency-key',
      gatewayPaymentId: withGatewayId ? gatewayPaymentId : undefined,
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
    };

    fakeGateway = new FakePaymentGateway();

    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    syncPayment = new SyncPaymentWithGateway(mockPaymentRepository, fakeGateway);
  });

  // Debería aplicar el estado del proveedor cuando este avanzó
  it('should apply the provider status and report the payment as changed', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
      gatewayPaymentId,
      status: 'approved',
      externalReference: payment.id,
    });

    const result = await syncPayment.execute(payment.id);

    expect(result.changed).toBe(true);
    expect(result.payment.status).toBe(PaymentStatusEnum.COMPLETED);
    expect(result.payment.method).toBe(PaymentMethodEnum.ONLINE);
    expect(result.payment.gatewayStatus).toBe('approved');
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
  });

  // Un pago ya al día no cambia, pero igual queda constancia de la consulta
  it('should report no change and still persist when the payment is already up to date', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.COMPLETED);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
      gatewayPaymentId,
      status: 'approved',
    });

    const result = await syncPayment.execute(payment.id);

    expect(result.changed).toBe(false);
    expect(result.payment.status).toBe(PaymentStatusEnum.COMPLETED);
    expect(result.payment.lastSyncedAt).toBeInstanceOf(Date);
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
  });

  // Una transición imposible no revierte el pago y no cuenta como cambio
  it('should report no change and keep the status when the transition is impossible', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.REFUNDED);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
      gatewayPaymentId,
      status: 'approved',
    });

    const result = await syncPayment.execute(payment.id);

    expect(result.changed).toBe(false);
    expect(result.payment.status).toBe(PaymentStatusEnum.REFUNDED);
  });

  // Un reembolso hecho desde el panel del proveedor se recupera por acá
  it('should pick up a refund made outside the application', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.COMPLETED);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
      gatewayPaymentId,
      status: 'refunded',
      refundedAmount: 200.0,
    });

    const result = await syncPayment.execute(payment.id);

    expect(result.changed).toBe(true);
    expect(result.payment.status).toBe(PaymentStatusEnum.REFUNDED);
    expect(result.payment.refundedAmount).toBe(200.0);
  });

  // Debería lanzar NotFoundError si el pago no existe
  it('should throw NotFoundError when the payment does not exist', async () => {
    mockPaymentRepository.findById.mockResolvedValue(null);

    await expect(syncPayment.execute('123e4567-e89b-12d3-a456-426614174091')).rejects.toThrow(
      NotFoundError,
    );

    expect(fakeGateway.getPaymentCalls).toHaveLength(0);
  });

  // Un pago manual no tiene estado en ningún proveedor que consultar
  it('should throw BusinessRuleError for a manual payment', async () => {
    const manualPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174092',
      amount: 100.0,
      status: PaymentStatusEnum.COMPLETED,
      method: PaymentMethodEnum.CASH,
      paymentDate: new Date(),
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPaymentRepository.findById.mockResolvedValue(manualPayment);

    await expect(syncPayment.execute(manualPayment.id)).rejects.toThrow(BusinessRuleError);

    expect(fakeGateway.getPaymentCalls).toHaveLength(0);
    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Sin identificador en la pasarela no hay a qué apuntar la consulta
  it('should throw BusinessRuleError when the payment has no gateway payment id yet', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.PENDING, false);
    mockPaymentRepository.findById.mockResolvedValue(payment);

    await expect(syncPayment.execute(payment.id)).rejects.toThrow(BusinessRuleError);

    expect(fakeGateway.getPaymentCalls).toHaveLength(0);
    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Que el proveedor no reconozca el id no se arregla reintentando: no es 502
  it('should throw BusinessRuleError when the gateway does not recognize the payment', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
    mockPaymentRepository.findById.mockResolvedValue(payment);

    await expect(syncPayment.execute(payment.id)).rejects.toThrow(BusinessRuleError);

    expect(fakeGateway.getPaymentCalls).toEqual([gatewayPaymentId]);
    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Un fallo del proveedor externo sí es 502: reintentar puede ayudar
  it('should fail with 502 when the gateway does not respond', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.getPaymentError = new Error('MercadoPago timeout');

    await expect(syncPayment.execute(payment.id)).rejects.toMatchObject({ statusCode: 502 });

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Sin pasarela configurada el fallo es de este servidor: 422, no 502
  it('should repropagate the original error when the gateway is not configured', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.getPaymentError = new BusinessRuleError('Payment gateway is not configured');

    await expect(syncPayment.execute(payment.id)).rejects.toMatchObject({ statusCode: 422 });

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Un estado que el proveedor no documenta no debe tumbar la sincronización
  it('should not throw for an unknown provider status', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
      gatewayPaymentId,
      status: 'some_new_status_mercadopago_invented',
    });

    const result = await syncPayment.execute(payment.id);

    expect(result.changed).toBe(false);
    expect(result.payment.status).toBe(PaymentStatusEnum.PENDING);
    expect(result.payment.gatewayStatus).toBe('some_new_status_mercadopago_invented');
  });

  // El rechazo del proveedor se aplica con su detalle
  it('should apply a rejected provider status with its detail', async () => {
    const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
    mockPaymentRepository.findById.mockResolvedValue(payment);
    fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
      gatewayPaymentId,
      status: 'rejected',
      statusDetail: 'cc_rejected_insufficient_amount',
    });

    const result = await syncPayment.execute(payment.id);

    expect(result.changed).toBe(true);
    expect(result.payment.status).toBe(PaymentStatusEnum.FAILED);
    expect(result.payment.failureReason).toBe('cc_rejected_insufficient_amount');
  });
});
