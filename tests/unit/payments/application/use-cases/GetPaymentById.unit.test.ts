import { GetPaymentById } from '../../../../../src/modules/payments/application/use-cases/GetPaymentById';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import {
  Payment,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';

describe('GetPaymentById Use Case', () => {
  let getPaymentById: GetPaymentById;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;

  // Constantes de permisos -- tests existentes usan ADMIN para bypass de ownership
  const adminRequesterId = 'admin-requester-id';
  const adminRole = 'ADMIN';

  const validStylistId = '123e4567-e89b-12d3-a456-426614174010';
  const validClientId = '123e4567-e89b-12d3-a456-426614174011';
  const validUserId = '123e4567-e89b-12d3-a456-426614174012';

  const mockAppointment = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    stylistId: validStylistId,
    clientId: validClientId,
    userId: validUserId,
  };

  const mockPayment = new Payment({
    id: '123e4567-e89b-12d3-a456-426614174000',
    amount: 100.50,
    status: PaymentStatusEnum.COMPLETED,
    method: PaymentMethodEnum.CREDIT_CARD,
    paymentDate: new Date('2025-01-15T12:00:00Z'),
    appointmentId: mockAppointment.id,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    updatedAt: new Date('2025-01-15T12:00:00Z'),
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

    mockAppointmentRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IAppointmentRepository>;

    getPaymentById = new GetPaymentById(mockPaymentRepository, mockAppointmentRepository);
  });

  // Debería retornar un pago existente
  it('should return an existing payment', async () => {
    mockPaymentRepository.findById.mockResolvedValue(mockPayment);

    const result = await getPaymentById.execute(mockPayment.id, adminRequesterId, adminRole);

    expect(result.id).toBe(mockPayment.id);
    expect(result.amount).toBe(100.50);
    expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
    expect(result.method).toBe(PaymentMethodEnum.CREDIT_CARD);
    expect(result.appointmentId).toBe(mockPayment.appointmentId);
    expect(mockPaymentRepository.findById).toHaveBeenCalledWith(mockPayment.id);
  });

  // Debería lanzar NotFoundError si el pago no existe
  it('should throw NotFoundError if payment does not exist', async () => {
    const nonExistentId = '999e4567-e89b-12d3-a456-426614174999';
    mockPaymentRepository.findById.mockResolvedValue(null);

    await expect(
      getPaymentById.execute(nonExistentId, adminRequesterId, adminRole),
    ).rejects.toThrow(NotFoundError);
    expect(mockPaymentRepository.findById).toHaveBeenCalledWith(nonExistentId);
  });

  // Debería retornar todos los campos del pago
  it('should return all payment fields', async () => {
    mockPaymentRepository.findById.mockResolvedValue(mockPayment);

    const result = await getPaymentById.execute(mockPayment.id, adminRequesterId, adminRole);

    expect(result).toEqual({
      id: mockPayment.id,
      amount: mockPayment.amount,
      status: mockPayment.status,
      method: mockPayment.method,
      paymentDate: mockPayment.paymentDate,
      appointmentId: mockPayment.appointmentId,
      createdAt: mockPayment.createdAt,
      updatedAt: mockPayment.updatedAt,
      provider: PaymentProviderEnum.MANUAL,
    });
  });

  // Debería manejar pagos pendientes (sin método ni fecha)
  it('should handle pending payments (without method or date)', async () => {
    const pendingPayment = new Payment({
      id: '123e4567-e89b-12d3-a456-426614174002',
      amount: 75.00,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId: mockAppointment.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPaymentRepository.findById.mockResolvedValue(pendingPayment);

    const result = await getPaymentById.execute(pendingPayment.id, adminRequesterId, adminRole);

    expect(result.status).toBe(PaymentStatusEnum.PENDING);
    expect(result.method).toBeNull();
    expect(result.paymentDate).toBeNull();
  });

  describe('Ownership (F18)', () => {
    // Debería permitir a ADMIN ver cualquier pago sin necesidad de resolver la cita
    it('should allow ADMIN to view any payment without resolving the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(mockPayment);

      const result = await getPaymentById.execute(mockPayment.id, 'any-admin-id', 'ADMIN');

      expect(result.id).toBe(mockPayment.id);
      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
    });

    // Debería permitir al STYLIST dueño de la cita ver el pago
    it('should allow the owning stylist to view the payment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(mockPayment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      const result = await getPaymentById.execute(mockPayment.id, validStylistId, 'STYLIST');

      expect(result.id).toBe(mockPayment.id);
      expect(mockAppointmentRepository.findById).toHaveBeenCalledWith(mockAppointment.id);
    });

    // STYLIST ajeno a la cita no debe poder acceder al pago
    it('should throw ForbiddenError when stylist does not own the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(mockPayment);
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        getPaymentById.execute(mockPayment.id, 'other-stylist-id', 'STYLIST'),
      ).rejects.toThrow(ForbiddenError);
    });

    // CLIENT nunca llega a este use case en producción (GET /payments/:id solo
    // autoriza ADMIN/STYLIST en la ruta); el use case igual debe bloquearlo si
    // se invoca directamente, sin resolver la cita (hallazgo #2, Opción A)
    it('should throw ForbiddenError for CLIENT without resolving the appointment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(mockPayment);

      await expect(
        getPaymentById.execute(mockPayment.id, validClientId, 'CLIENT'),
      ).rejects.toThrow(ForbiddenError);
      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
    });

    // Cualquier otro rol no contemplado también debe ser rechazado por defecto
    it('should throw ForbiddenError for any other unrecognized role', async () => {
      mockPaymentRepository.findById.mockResolvedValue(mockPayment);

      await expect(
        getPaymentById.execute(mockPayment.id, 'some-id', 'UNKNOWN_ROLE'),
      ).rejects.toThrow(ForbiddenError);
      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
    });

    // Debería lanzar NotFoundError si la cita asociada al pago ya no existe
    it('should throw NotFoundError when the associated appointment no longer exists', async () => {
      mockPaymentRepository.findById.mockResolvedValue(mockPayment);
      mockAppointmentRepository.findById.mockResolvedValue(null);

      await expect(
        getPaymentById.execute(mockPayment.id, validStylistId, 'STYLIST'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
