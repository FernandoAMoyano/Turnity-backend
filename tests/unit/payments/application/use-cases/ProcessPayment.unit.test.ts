import { ProcessPayment } from '../../../../../src/modules/payments/application/use-cases/ProcessPayment';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { Payment, PaymentStatusEnum, PaymentMethodEnum, PaymentProviderEnum } from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';

describe('ProcessPayment Use Case', () => {
  let processPayment: ProcessPayment;
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

    processPayment = new ProcessPayment(mockPaymentRepository, mockAppointmentRepository);
  });

  // Debería procesar un pago pendiente exitosamente
  it('should process a pending payment successfully', async () => {
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

    const result = await processPayment.execute(
      {
        paymentId: pendingPayment.id,
        method: PaymentMethodEnum.CREDIT_CARD,
      },
      adminRequesterId,
      adminRole,
    );

    expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
    expect(result.method).toBe(PaymentMethodEnum.CREDIT_CARD);
    expect(result.paymentDate).toBeInstanceOf(Date);
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
  });

  // Debería lanzar NotFoundError si el pago no existe
  it('should throw NotFoundError if payment does not exist', async () => {
    mockPaymentRepository.findById.mockResolvedValue(null);

    await expect(
      processPayment.execute(
        {
          paymentId: 'non-existent-id',
          method: PaymentMethodEnum.CASH,
        },
        adminRequesterId,
        adminRole,
      ),
    ).rejects.toThrow(NotFoundError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el pago no está pendiente
  it('should throw BusinessRuleError if payment is not pending', async () => {
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
      processPayment.execute(
        {
          paymentId: completedPayment.id,
          method: PaymentMethodEnum.CREDIT_CARD,
        },
        adminRequesterId,
        adminRole,
      ),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería funcionar con todos los métodos de pago
  it('should work with all payment methods', async () => {
    const methods = [
      PaymentMethodEnum.CASH,
      PaymentMethodEnum.CREDIT_CARD,
      PaymentMethodEnum.DEBIT_CARD,
      PaymentMethodEnum.TRANSFER,
      PaymentMethodEnum.ONLINE,
    ];

    for (const method of methods) {
      const pendingPayment = new Payment({
        id: `payment-${method}`,
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

      const result = await processPayment.execute(
        {
          paymentId: pendingPayment.id,
          method,
        },
        adminRequesterId,
        adminRole,
      );

      expect(result.method).toBe(method);
      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
    }
  });

  // No debería procesar un pago ya reembolsado
  it('should not process an already refunded payment', async () => {
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
      processPayment.execute(
        {
          paymentId: refundedPayment.id,
          method: PaymentMethodEnum.CASH,
        },
        adminRequesterId,
        adminRole,
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  // No debería procesar un pago fallido
  it('should not process a failed payment', async () => {
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
      processPayment.execute(
        {
          paymentId: failedPayment.id,
          method: PaymentMethodEnum.CASH,
        },
        adminRequesterId,
        adminRole,
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  describe('Ownership (F18)', () => {
    // Payment.markAsCompleted() muta la entidad en el lugar, así que cada test
    // necesita su propia instancia -- reusar una sola entre tests contaminaría
    // el estado (un test la deja COMPLETED y el siguiente ya no puede procesarla)
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

    // Debería permitir a ADMIN procesar cualquier pago sin resolver la cita
    it('should allow ADMIN to process any payment without resolving the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockPaymentRepository.update.mockImplementation(async (payment) => payment);

      const result = await processPayment.execute(
        { paymentId: pendingPayment.id, method: PaymentMethodEnum.CASH },
        'any-admin-id',
        'ADMIN',
      );

      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
    });

    // Debería permitir al STYLIST dueño de la cita procesar el pago
    it('should allow the owning stylist to process the payment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockPaymentRepository.update.mockImplementation(async (payment) => payment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      const result = await processPayment.execute(
        { paymentId: pendingPayment.id, method: PaymentMethodEnum.CASH },
        validStylistId,
        'STYLIST',
      );

      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
    });

    // STYLIST ajeno a la cita no debe poder acceder al pago
    it('should throw ForbiddenError when stylist does not own the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        processPayment.execute(
          { paymentId: pendingPayment.id, method: PaymentMethodEnum.CASH },
          'other-stylist-id',
          'STYLIST',
        ),
      ).rejects.toThrow(ForbiddenError);

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // CLIENT no tiene acceso a esta operación bajo ninguna circunstancia
    it('should throw ForbiddenError for CLIENT regardless of ownership', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);

      await expect(
        processPayment.execute(
          { paymentId: pendingPayment.id, method: PaymentMethodEnum.CASH },
          mockAppointment.clientId,
          'CLIENT',
        ),
      ).rejects.toThrow(ForbiddenError);

      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería lanzar NotFoundError si la cita asociada al pago ya no existe
    it('should throw NotFoundError when the associated appointment no longer exists', async () => {
      mockPaymentRepository.findById.mockResolvedValue(pendingPayment);
      mockAppointmentRepository.findById.mockResolvedValue(null);

      await expect(
        processPayment.execute(
          { paymentId: pendingPayment.id, method: PaymentMethodEnum.CASH },
          validStylistId,
          'STYLIST',
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Gateway-backed guard', () => {
    const buildGatewayPayment = (status: PaymentStatusEnum): Payment =>
      new Payment({
        id: '123e4567-e89b-12d3-a456-426614174060',
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

    // Un pago de pasarela pendiente no debe poder completarse a mano: sería
    // dar por cobrado un dinero que todavía no entró
    it('should throw BusinessRuleError for a pending gateway-backed payment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
      mockPaymentRepository.findById.mockResolvedValue(payment);

      await expect(
        processPayment.execute(
          { paymentId: payment.id, method: PaymentMethodEnum.CASH },
          adminRequesterId,
          adminRole,
        ),
      ).rejects.toThrow(BusinessRuleError);

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(payment.status).toBe(PaymentStatusEnum.PENDING);
    });

    // La guarda va antes del chequeo de estado: el motivo tiene que ser que el
    // pago es de pasarela, no que no esté pendiente
    it('should report the gateway reason instead of the pending-state reason for a completed gateway-backed payment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.COMPLETED);
      mockPaymentRepository.findById.mockResolvedValue(payment);

      await expect(
        processPayment.execute(
          { paymentId: payment.id, method: PaymentMethodEnum.CASH },
          adminRequesterId,
          adminRole,
        ),
      ).rejects.toThrow(/gateway/i);
    });

    // La guarda va después del NotFoundError: un pago inexistente sigue siendo 404
    it('should still throw NotFoundError when the payment does not exist', async () => {
      mockPaymentRepository.findById.mockResolvedValue(null);

      await expect(
        processPayment.execute(
          { paymentId: '123e4567-e89b-12d3-a456-426614174061', method: PaymentMethodEnum.CASH },
          adminRequesterId,
          adminRole,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    // La guarda va después de la autorización: un STYLIST ajeno recibe 403 y
    // no se entera de que el pago es de pasarela
    it('should throw ForbiddenError before the guard when the stylist does not own the appointment', async () => {
      const payment = buildGatewayPayment(PaymentStatusEnum.PENDING);
      mockPaymentRepository.findById.mockResolvedValue(payment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        processPayment.execute(
          { paymentId: payment.id, method: PaymentMethodEnum.CASH },
          'other-stylist-id',
          'STYLIST',
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
