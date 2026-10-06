import { CancelPayment } from '../../../../../src/modules/payments/application/use-cases/CancelPayment';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { Payment, PaymentStatusEnum, PaymentMethodEnum, PaymentProviderEnum } from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';

describe('CancelPayment Use Case', () => {
  let cancelPayment: CancelPayment;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;

  // Constantes de permisos -- tests existentes usan ADMIN para bypass de ownership
  const adminRequesterId = 'admin-requester-id';
  const adminRole = 'ADMIN';

  const validStylistId = '123e4567-e89b-12d3-a456-426614174010';
  const validAppointmentId = '123e4567-e89b-12d3-a456-426614174001';

  const mockAppointment = {
    id: validAppointmentId,
    stylistId: validStylistId,
    clientId: '123e4567-e89b-12d3-a456-426614174011',
    userId: '123e4567-e89b-12d3-a456-426614174012',
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

    cancelPayment = new CancelPayment(mockPaymentRepository, mockAppointmentRepository);
  });

  // Debería cancelar un pago pendiente exitosamente
  it('should cancel a pending payment successfully', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await cancelPayment.execute(pendingPayment.id, adminRequesterId, adminRole);

    expect(result.status).toBe(PaymentStatusEnum.FAILED);
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
  });

  // Debería lanzar NotFoundError si el pago no existe
  it('should throw NotFoundError if payment does not exist', async () => {
    mockPaymentRepository.findById.mockResolvedValue(null);

    await expect(
      cancelPayment.execute('non-existent-id', adminRequesterId, adminRole),
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
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(completedPayment);

    await expect(
      cancelPayment.execute(completedPayment.id, adminRequesterId, adminRole),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el pago ya fue reembolsado
  it('should throw BusinessRuleError if payment is already refunded', async () => {
    const refundedPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.REFUNDED,
      method: PaymentMethodEnum.CREDIT_CARD,
      paymentDate: new Date(),
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(refundedPayment);

    await expect(
      cancelPayment.execute(refundedPayment.id, adminRequesterId, adminRole),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el pago ya está fallido
  it('should throw BusinessRuleError if payment is already failed', async () => {
    const failedPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.FAILED,
      method: null,
      paymentDate: null,
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(failedPayment);

    await expect(
      cancelPayment.execute(failedPayment.id, adminRequesterId, adminRole),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería mantener el monto original después de cancelar
  it('should keep original amount after cancellation', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 250.75,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await cancelPayment.execute(pendingPayment.id, adminRequesterId, adminRole);

    expect(result.amount).toBe(250.75);
    expect(result.appointmentId).toBe(pendingPayment.appointmentId);
  });

  // Debería mantener method y paymentDate como null después de cancelar
  it('should keep method and paymentDate as null after cancellation', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await cancelPayment.execute(pendingPayment.id, adminRequesterId, adminRole);

    expect(result.method).toBeNull();
    expect(result.paymentDate).toBeNull();
  });

  describe('Ownership (F18)', () => {
    // Payment.markAsFailed() muta la entidad en el lugar, así que cada test
    // necesita su propia instancia -- reusar una sola entre tests contaminaría
    // el estado (un test la deja FAILED y el siguiente ya no puede cancelarla)
    let pendingPayment: Payment;

    beforeEach(() => {
      pendingPayment = new Payment({
        id: '123e4567-e89b-12d3-a456-426614174099',
        amount: 100.00,
        status: PaymentStatusEnum.PENDING,
        method: null,
        paymentDate: null,
        appointmentId: validAppointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    // Debería permitir a ADMIN cancelar cualquier pago sin resolver la cita
    it('should allow ADMIN to cancel any payment without resolving the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockPaymentRepository.update.mockImplementation(async (payment) => payment);

      const result = await cancelPayment.execute(pendingPayment.id, 'any-admin-id', 'ADMIN');

      expect(result.status).toBe(PaymentStatusEnum.FAILED);
      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
    });

    // Debería permitir al STYLIST dueño de la cita cancelar el pago
    it('should allow the owning stylist to cancel the payment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockPaymentRepository.update.mockImplementation(async (payment) => payment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      const result = await cancelPayment.execute(pendingPayment.id, validStylistId, 'STYLIST');

      expect(result.status).toBe(PaymentStatusEnum.FAILED);
    });

    // STYLIST ajeno a la cita no debe poder acceder al pago
    it('should throw ForbiddenError when stylist does not own the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        cancelPayment.execute(pendingPayment.id, 'other-stylist-id', 'STYLIST'),
      ).rejects.toThrow(ForbiddenError);

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // CLIENT no tiene acceso a esta operación bajo ninguna circunstancia
    it('should throw ForbiddenError for CLIENT regardless of ownership', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);

      await expect(
        cancelPayment.execute(pendingPayment.id, mockAppointment.clientId, 'CLIENT'),
      ).rejects.toThrow(ForbiddenError);

      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería lanzar NotFoundError si la cita asociada al pago ya no existe
    it('should throw NotFoundError when the associated appointment no longer exists', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockAppointmentRepository.findById.mockResolvedValue(null);

      await expect(
        cancelPayment.execute(pendingPayment.id, validStylistId, 'STYLIST'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Gateway-backed guard', () => {
    const buildGatewayPayment = (status: PaymentStatusEnum): Payment =>
      new Payment({
        id: '123e4567-e89b-12d3-a456-426614174070',
        amount: 100.0,
        status,
        method: status === PaymentStatusEnum.PENDING ? null : PaymentMethodEnum.ONLINE,
        paymentDate: status === PaymentStatusEnum.PENDING ? null : new Date(),
        appointmentId: validAppointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey: 'gateway-idempotency-key',
      });

    // Dar de baja localmente un checkout que sigue abierto en la pasarela
    // dejaría el pago fallido acá y pagable allá
    it('should throw BusinessRuleError for a pending gateway-backed payment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
      mockPaymentRepository.findById.mockResolvedValue(payment);

      await expect(
        cancelPayment.execute(payment.id, adminRequesterId, adminRole),
      ).rejects.toThrow(BusinessRuleError);

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(payment.status).toBe(PaymentStatusEnum.PENDING);
    });

    // La guarda va antes del chequeo de estado
    it('should report the gateway reason instead of the pending-state reason for a completed gateway-backed payment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.COMPLETED);
      mockPaymentRepository.findById.mockResolvedValue(payment);

      await expect(
        cancelPayment.execute(payment.id, adminRequesterId, adminRole),
      ).rejects.toThrow(/gateway/i);
    });

    // La guarda va después del NotFoundError
    it('should still throw NotFoundError when the payment does not exist', async () => {
      mockPaymentRepository.findById.mockResolvedValue(null);

      await expect(
        cancelPayment.execute(
          '123e4567-e89b-12d3-a456-426614174071',
          adminRequesterId,
          adminRole,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    // La guarda va después de la autorización
    it('should throw ForbiddenError before the guard when the stylist does not own the appointment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
      mockPaymentRepository.findById.mockResolvedValue(payment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        cancelPayment.execute(payment.id, 'other-stylist-id', 'STYLIST'),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
