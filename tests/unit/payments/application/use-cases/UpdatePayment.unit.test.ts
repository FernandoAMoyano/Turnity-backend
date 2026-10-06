import { UpdatePayment } from '../../../../../src/modules/payments/application/use-cases/UpdatePayment';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { Payment, PaymentStatusEnum, PaymentMethodEnum, PaymentProviderEnum } from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';

describe('UpdatePayment Use Case', () => {
  let updatePayment: UpdatePayment;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;

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

    updatePayment = new UpdatePayment(mockPaymentRepository);
  });

  // Debería actualizar el monto de un pago pendiente
  it('should update amount of a pending payment', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await updatePayment.execute(pendingPayment.id, { amount: 150.00 });

    expect(result.amount).toBe(150.00);
    expect(result.status).toBe(PaymentStatusEnum.PENDING);
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
  });

  // Debería lanzar NotFoundError si el pago no existe
  it('should throw NotFoundError if payment does not exist', async () => {
    mockPaymentRepository.findById.mockResolvedValue(null);

    await expect(
      updatePayment.execute('non-existent-id', { amount: 100 }),
    ).rejects.toThrow(NotFoundError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el pago está completado
  it('should throw BusinessRuleError if payment is completed', async () => {
    const completedPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.COMPLETED,
      method: PaymentMethodEnum.CASH,
      paymentDate: new Date(),
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(completedPayment);

    await expect(
      updatePayment.execute(completedPayment.id, { amount: 200 }),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el monto es 0
  it('should throw BusinessRuleError if amount is 0', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);

    await expect(
      updatePayment.execute(pendingPayment.id, { amount: 0 }),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el monto es negativo
  it('should throw BusinessRuleError if amount is negative', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);

    await expect(
      updatePayment.execute(pendingPayment.id, { amount: -50 }),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el pago fue reembolsado
  it('should throw BusinessRuleError if payment was refunded', async () => {
    const refundedPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.REFUNDED,
      method: PaymentMethodEnum.CREDIT_CARD,
      paymentDate: new Date(),
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(refundedPayment);

    await expect(
      updatePayment.execute(refundedPayment.id, { amount: 200 }),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el pago falló
  it('should throw BusinessRuleError if payment failed', async () => {
    const failedPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.FAILED,
      method: null,
      paymentDate: null,
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(failedPayment);

    await expect(
      updatePayment.execute(failedPayment.id, { amount: 200 }),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // No debería hacer cambios si amount es undefined
  it('should not make changes if amount is undefined', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await updatePayment.execute(pendingPayment.id, {});

    expect(result.amount).toBe(100.00);
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
  });

  // Debería actualizar con montos decimales
  it('should update with decimal amounts', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await updatePayment.execute(pendingPayment.id, { amount: 99.99 });

    expect(result.amount).toBe(99.99);
  });

  describe('Gateway-backed guard', () => {
    const buildGatewayPayment = (status: PaymentStatusEnum): Payment =>
      new Payment({
        id: '123e4567-e89b-12d3-a456-426614174080',
        amount: 100.0,
        status,
        method: status === PaymentStatusEnum.PENDING ? null : PaymentMethodEnum.ONLINE,
        paymentDate: status === PaymentStatusEnum.PENDING ? null : new Date(),
        appointmentId: '123e4567-e89b-12d3-a456-426614174001',
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey: 'gateway-idempotency-key',
      });

    // El monto ya está comprometido en la pasarela: cambiarlo de este lado
    // dejaría los dos importes distintos sin forma de reconciliarlos
    it('should throw BusinessRuleError for a pending gateway-backed payment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
      mockPaymentRepository.findById.mockResolvedValue(payment);

      await expect(updatePayment.execute(payment.id, { amount: 150.0 })).rejects.toThrow(
        BusinessRuleError,
      );

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(payment.amount).toBe(100.0);
    });

    // La guarda va antes del chequeo de estado
    it('should report the gateway reason instead of the pending-state reason for a completed gateway-backed payment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.COMPLETED);
      mockPaymentRepository.findById.mockResolvedValue(payment);

      await expect(updatePayment.execute(payment.id, { amount: 150.0 })).rejects.toThrow(
        /gateway/i,
      );
    });

    // La guarda va antes de la validación del monto: el monto no se puede
    // cambiar de ninguna forma, así que discutir si es válido sobra
    it('should reject a gateway-backed payment even when no amount is sent', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
      mockPaymentRepository.findById.mockResolvedValue(payment);

      await expect(updatePayment.execute(payment.id, {})).rejects.toThrow(/gateway/i);
    });

    // La guarda va después del NotFoundError
    it('should still throw NotFoundError when the payment does not exist', async () => {
      mockPaymentRepository.findById.mockResolvedValue(null);

      await expect(
        updatePayment.execute('123e4567-e89b-12d3-a456-426614174081', { amount: 150.0 }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
