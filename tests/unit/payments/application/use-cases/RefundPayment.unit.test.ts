import { RefundPayment } from '../../../../../src/modules/payments/application/use-cases/RefundPayment';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { Payment, PaymentStatusEnum, PaymentMethodEnum, PaymentProviderEnum } from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';

describe('RefundPayment Use Case', () => {
  let refundPayment: RefundPayment;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let fakeGateway: FakePaymentGateway;

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

    fakeGateway = new FakePaymentGateway();

    refundPayment = new RefundPayment(
      mockPaymentRepository,
      mockAppointmentRepository,
      fakeGateway,
    );
  });

  // Debería reembolsar un pago completado exitosamente
  it('should refund a completed payment successfully', async () => {
    const completedPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.00,
      status: PaymentStatusEnum.COMPLETED,
      method: PaymentMethodEnum.CREDIT_CARD,
      paymentDate: new Date(),
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(completedPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await refundPayment.execute(
      {
        paymentId: completedPayment.id,
        reason: 'Cliente canceló la cita',
      },
      adminRequesterId,
      adminRole,
    );

    expect(result.status).toBe(PaymentStatusEnum.REFUNDED);
    expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
  });

  // Debería reembolsar sin razón (razón opcional)
  it('should refund without reason (reason is optional)', async () => {
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
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await refundPayment.execute(
      {
        paymentId: completedPayment.id,
      },
      adminRequesterId,
      adminRole,
    );

    expect(result.status).toBe(PaymentStatusEnum.REFUNDED);
  });

  // Debería lanzar NotFoundError si el pago no existe
  it('should throw NotFoundError if payment does not exist', async () => {
    mockPaymentRepository.findById.mockResolvedValue(null);

    await expect(
      refundPayment.execute(
        {
          paymentId: 'non-existent-id',
        },
        adminRequesterId,
        adminRole,
      ),
    ).rejects.toThrow(NotFoundError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería lanzar BusinessRuleError si el pago está pendiente
  it('should throw BusinessRuleError if payment is pending', async () => {
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

    await expect(
      refundPayment.execute(
        {
          paymentId: pendingPayment.id,
        },
        adminRequesterId,
        adminRole,
      ),
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
      refundPayment.execute(
        {
          paymentId: refundedPayment.id,
        },
        adminRequesterId,
        adminRole,
      ),
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
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(failedPayment);

    await expect(
      refundPayment.execute(
        {
          paymentId: failedPayment.id,
        },
        adminRequesterId,
        adminRole,
      ),
    ).rejects.toThrow(BusinessRuleError);

    expect(mockPaymentRepository.update).not.toHaveBeenCalled();
  });

  // Debería mantener el método de pago original después del reembolso
  it('should keep original payment method after refund', async () => {
    const completedPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 150.00,
      status: PaymentStatusEnum.COMPLETED,
      method: PaymentMethodEnum.TRANSFER,
      paymentDate: new Date(),
      appointmentId: validAppointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(completedPayment);
    mockPaymentRepository.update.mockImplementation(async (payment) => payment);

    const result = await refundPayment.execute(
      {
        paymentId: completedPayment.id,
      },
      adminRequesterId,
      adminRole,
    );

    expect(result.method).toBe(PaymentMethodEnum.TRANSFER);
    expect(result.amount).toBe(150.00);
  });

  describe('Ownership (F18)', () => {
    // Payment.refund() muta la entidad en el lugar, así que cada test necesita
    // su propia instancia -- reusar una sola entre tests contaminaría el
    // estado (un test la deja REFUNDED y el siguiente ya no puede reembolsarla)
    let completedPayment: Payment;

    beforeEach(() => {
      completedPayment = new Payment({
        id: '123e4567-e89b-12d3-a456-426614174099',
        amount: 100.00,
        status: PaymentStatusEnum.COMPLETED,
        method: PaymentMethodEnum.CASH,
        paymentDate: new Date(),
        appointmentId: validAppointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    // Debería permitir a ADMIN reembolsar cualquier pago sin resolver la cita
    it('should allow ADMIN to refund any payment without resolving the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(completedPayment);
      mockPaymentRepository.update.mockImplementation(async (payment) => payment);

      const result = await refundPayment.execute(
        { paymentId: completedPayment.id },
        'any-admin-id',
        'ADMIN',
      );

      expect(result.status).toBe(PaymentStatusEnum.REFUNDED);
      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
    });

    // Debería permitir al STYLIST dueño de la cita reembolsar el pago
    it('should allow the owning stylist to refund the payment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(completedPayment);
      mockPaymentRepository.update.mockImplementation(async (payment) => payment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      const result = await refundPayment.execute(
        { paymentId: completedPayment.id },
        validStylistId,
        'STYLIST',
      );

      expect(result.status).toBe(PaymentStatusEnum.REFUNDED);
    });

    // STYLIST ajeno a la cita no debe poder acceder al pago
    it('should throw ForbiddenError when stylist does not own the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(completedPayment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        refundPayment.execute(
          { paymentId: completedPayment.id },
          'other-stylist-id',
          'STYLIST',
        ),
      ).rejects.toThrow(ForbiddenError);

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // CLIENT no tiene acceso a esta operación bajo ninguna circunstancia
    it('should throw ForbiddenError for CLIENT regardless of ownership', async () => {
      mockPaymentRepository.findById.mockResolvedValue(completedPayment);

      await expect(
        refundPayment.execute(
          { paymentId: completedPayment.id },
          mockAppointment.clientId,
          'CLIENT',
        ),
      ).rejects.toThrow(ForbiddenError);

      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería lanzar NotFoundError si la cita asociada al pago ya no existe
    it('should throw NotFoundError when the associated appointment no longer exists', async () => {
      mockPaymentRepository.findById.mockResolvedValue(completedPayment);
      mockAppointmentRepository.findById.mockResolvedValue(null);

      await expect(
        refundPayment.execute(
          { paymentId: completedPayment.id },
          validStylistId,
          'STYLIST',
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Gateway-backed refunds', () => {
    const gatewayPaymentId = 'MP-987654';

    // Igual que en Ownership: la entidad se muta en el lugar, así que cada
    // test necesita la suya
    let gatewayPayment: Payment;

    beforeEach(() => {
      gatewayPayment = new Payment({
        id: '123e4567-e89b-12d3-a456-426614174050',
        amount: 250.0,
        status: PaymentStatusEnum.COMPLETED,
        method: PaymentMethodEnum.ONLINE,
        paymentDate: new Date(),
        appointmentId: validAppointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey: 'checkout-idempotency-key',
        gatewayPaymentId,
      });

      mockPaymentRepository.findById.mockResolvedValue(gatewayPayment);
      mockPaymentRepository.update.mockImplementation(async (payment) => payment);
    });

    // Debería reembolsar contra la pasarela cuando esta lo confirma
    it('should mark the payment as refunded when the gateway approves the refund', async () => {
      fakeGateway.refundResult = {
        gatewayRefundId: 'refund-1',
        amount: 250.0,
        status: 'approved',
      };

      const result = await refundPayment.execute(
        { paymentId: gatewayPayment.id },
        adminRequesterId,
        adminRole,
      );

      expect(result.status).toBe(PaymentStatusEnum.REFUNDED);
      expect(result.gatewayRefundId).toBe('refund-1');
      expect(result.refundedAmount).toBe(250.0);
      expect(result.gatewayStatus).toBe('refunded');
      expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
    });

    // La clave de idempotencia debe derivarse del pago, no ser aleatoria
    it('should call the gateway once with a refund key derived from the payment id', async () => {
      await refundPayment.execute({ paymentId: gatewayPayment.id }, adminRequesterId, adminRole);

      expect(fakeGateway.refundCalls).toEqual([
        { gatewayPaymentId, idempotencyKey: `refund-${gatewayPayment.id}` },
      ]);
    });

    // La clave del reembolso no debe ser la del checkout: son operaciones distintas
    it('should not reuse the checkout idempotency key for the refund', async () => {
      await refundPayment.execute({ paymentId: gatewayPayment.id }, adminRequesterId, adminRole);

      expect(fakeGateway.refundCalls[0].idempotencyKey).not.toBe('checkout-idempotency-key');
    });

    // Un reembolso en curso no debe mover el estado del pago
    it('should keep the payment completed when the gateway leaves the refund pending', async () => {
      fakeGateway.refundResult = {
        gatewayRefundId: 'refund-2',
        amount: 250.0,
        status: 'pending',
      };

      const result = await refundPayment.execute(
        { paymentId: gatewayPayment.id },
        adminRequesterId,
        adminRole,
      );

      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(result.gatewayRefundId).toBe('refund-2');
      expect(result.refundedAmount).toBe(250.0);
      expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
    });

    // Un reembolso en curso no debe ensuciar el estado crudo del pago, que
    // sigue siendo el que informó la pasarela para el cobro
    it('should not write a refunded gateway status while the refund is pending', async () => {
      fakeGateway.refundResult = {
        gatewayRefundId: 'refund-2',
        amount: 250.0,
        status: 'pending',
      };

      const result = await refundPayment.execute(
        { paymentId: gatewayPayment.id },
        adminRequesterId,
        adminRole,
      );

      expect(result.gatewayStatus).toBeUndefined();
    });

    // Un reembolso rechazado es terminal: no se espera ninguna confirmación
    it('should fail with 502 and persist nothing when the gateway rejects the refund', async () => {
      fakeGateway.refundResult = {
        gatewayRefundId: 'refund-3',
        amount: 0,
        status: 'rejected',
      };

      await expect(
        refundPayment.execute({ paymentId: gatewayPayment.id }, adminRequesterId, adminRole),
      ).rejects.toMatchObject({ statusCode: 502 });

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(gatewayPayment.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(gatewayPayment.gatewayRefundId).toBeUndefined();
    });

    // Un fallo del proveedor externo es 502, no 422
    it('should fail with 502 when the gateway throws', async () => {
      fakeGateway.refundError = new Error('MercadoPago 500');

      await expect(
        refundPayment.execute({ paymentId: gatewayPayment.id }, adminRequesterId, adminRole),
      ).rejects.toMatchObject({ statusCode: 502 });

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Sin pasarela configurada el fallo es de este servidor: 422, no 502
    it('should repropagate the original error when the gateway is not configured', async () => {
      fakeGateway.refundError = new BusinessRuleError('Payment gateway is not configured');

      await expect(
        refundPayment.execute({ paymentId: gatewayPayment.id }, adminRequesterId, adminRole),
      ).rejects.toMatchObject({ statusCode: 422 });

      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Sin identificador en la pasarela no hay nada que reembolsar allá
    it('should throw BusinessRuleError without calling the gateway when there is no gateway payment id', async () => {
      const withoutGatewayId = new Payment({
        id: '123e4567-e89b-12d3-a456-426614174051',
        amount: 100.0,
        status: PaymentStatusEnum.COMPLETED,
        method: PaymentMethodEnum.ONLINE,
        paymentDate: new Date(),
        appointmentId: validAppointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey: 'another-key',
      });
      mockPaymentRepository.findById.mockResolvedValue(withoutGatewayId);

      await expect(
        refundPayment.execute({ paymentId: withoutGatewayId.id }, adminRequesterId, adminRole),
      ).rejects.toThrow(BusinessRuleError);

      expect(fakeGateway.refundCalls).toHaveLength(0);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // El chequeo de estado corre antes de gastar una llamada a la pasarela
    it('should reject a non-completed gateway payment before calling the gateway', async () => {
      const pendingGatewayPayment = new Payment({
        id: '123e4567-e89b-12d3-a456-426614174052',
        amount: 100.0,
        status: PaymentStatusEnum.PENDING,
        method: null,
        paymentDate: null,
        appointmentId: validAppointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey: 'pending-key',
        gatewayPaymentId,
      });
      mockPaymentRepository.findById.mockResolvedValue(pendingGatewayPayment);

      await expect(
        refundPayment.execute({ paymentId: pendingGatewayPayment.id }, adminRequesterId, adminRole),
      ).rejects.toThrow(BusinessRuleError);

      expect(fakeGateway.refundCalls).toHaveLength(0);
    });

    // La autorización corre antes que todo lo demás, también en este camino
    it('should reject a CLIENT before calling the gateway', async () => {
      await expect(
        refundPayment.execute(
          { paymentId: gatewayPayment.id },
          mockAppointment.clientId,
          'CLIENT',
        ),
      ).rejects.toThrow(ForbiddenError);

      expect(fakeGateway.refundCalls).toHaveLength(0);
    });

    // El motivo se conserva en los dos desenlaces que persisten
    it('should persist the refund reason when the gateway approves the refund', async () => {
      const result = await refundPayment.execute(
        { paymentId: gatewayPayment.id, reason: 'Cliente canceló la cita' },
        adminRequesterId,
        adminRole,
      );

      expect(result.refundReason).toBe('Cliente canceló la cita');
    });

    // Si el reembolso queda en curso, el motivo igual se guarda: la
    // notificación que después lo confirme no lo conoce
    it('should persist the refund reason while the refund is still pending', async () => {
      fakeGateway.refundResult = {
        gatewayRefundId: 'refund-4',
        amount: 250.0,
        status: 'pending',
      };

      const result = await refundPayment.execute(
        { paymentId: gatewayPayment.id, reason: 'Turno reprogramado' },
        adminRequesterId,
        adminRole,
      );

      expect(result.refundReason).toBe('Turno reprogramado');
    });

    // Regresión: el camino manual no debe tocar la pasarela
    it('should not call the gateway for a manual payment', async () => {
      const manualPayment = new Payment({
        id: '123e4567-e89b-12d3-a456-426614174053',
        amount: 100.0,
        status: PaymentStatusEnum.COMPLETED,
        method: PaymentMethodEnum.CASH,
        paymentDate: new Date(),
        appointmentId: validAppointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPaymentRepository.findById.mockResolvedValue(manualPayment);

      const result = await refundPayment.execute(
        { paymentId: manualPayment.id },
        adminRequesterId,
        adminRole,
      );

      expect(result.status).toBe(PaymentStatusEnum.REFUNDED);
      expect(fakeGateway.refundCalls).toHaveLength(0);
    });
  });
});
