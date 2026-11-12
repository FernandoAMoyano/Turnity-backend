import { GetPaymentsByAppointment } from '../../../../../src/modules/payments/application/use-cases/GetPaymentsByAppointment';
import { IPaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { Payment, PaymentStatusEnum, PaymentMethodEnum } from '../../../../../src/modules/payments/domain/entities/Payment';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';

describe('GetPaymentsByAppointment Use Case', () => {
  let getPaymentsByAppointment: GetPaymentsByAppointment;
  let mockPaymentRepository: jest.Mocked<IPaymentRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;

  // Constantes de permisos -- tests existentes usan ADMIN para bypass de ownership
  const adminRequesterId = 'admin-requester-id';
  const adminRole = 'ADMIN';

  const validStylistId = '123e4567-e89b-12d3-a456-426614174010';
  const validClientId = '123e4567-e89b-12d3-a456-426614174011';
  const validUserId = '123e4567-e89b-12d3-a456-426614174012';
  const validAppointmentId = '123e4567-e89b-12d3-a456-426614174001';

  const mockAppointment = {
    id: validAppointmentId,
    stylistId: validStylistId,
    clientId: validClientId,
    userId: validUserId,
  };

  const mockPayments = [
    new Payment({
      id: '123e4567-e89b-12d3-a456-426614174000',
      amount: 100.50,
      status: PaymentStatusEnum.COMPLETED,
      method: PaymentMethodEnum.CREDIT_CARD,
      paymentDate: new Date('2025-01-15T12:00:00Z'),
      appointmentId: validAppointmentId,
      createdAt: new Date('2025-01-15T10:00:00Z'),
      updatedAt: new Date('2025-01-15T12:00:00Z'),
    }),
  ];

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

    getPaymentsByAppointment = new GetPaymentsByAppointment(
      mockPaymentRepository,
      mockAppointmentRepository,
    );
  });

  // Debería retornar los pagos de una cita
  it('should return the payments of an appointment', async () => {
    mockPaymentRepository.findByAppointmentId.mockResolvedValue(mockPayments);

    const result = await getPaymentsByAppointment.execute(
      validAppointmentId,
      adminRequesterId,
      adminRole,
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(mockPayments[0].id);
    expect(mockPaymentRepository.findByAppointmentId).toHaveBeenCalledWith(validAppointmentId);
  });

  // Debería retornar array vacío cuando la cita no tiene pagos
  it('should return an empty array when the appointment has no payments', async () => {
    mockPaymentRepository.findByAppointmentId.mockResolvedValue([]);

    const result = await getPaymentsByAppointment.execute(
      validAppointmentId,
      adminRequesterId,
      adminRole,
    );

    expect(result).toEqual([]);
  });

  describe('Ownership', () => {
    // Debería permitir a ADMIN consultar pagos de cualquier cita sin resolverla
    it('should allow ADMIN to query any appointment without resolving it', async () => {
      mockPaymentRepository.findByAppointmentId.mockResolvedValue(mockPayments);

      const result = await getPaymentsByAppointment.execute(
        validAppointmentId,
        'any-admin-id',
        'ADMIN',
      );

      expect(result).toHaveLength(1);
      expect(mockAppointmentRepository.findById).not.toHaveBeenCalled();
    });

    // Debería permitir al STYLIST dueño de la cita consultar sus pagos
    it('should allow the owning stylist to query the payments', async () => {
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);
      mockPaymentRepository.findByAppointmentId.mockResolvedValue(mockPayments);

      const result = await getPaymentsByAppointment.execute(
        validAppointmentId,
        validStylistId,
        'STYLIST',
      );

      expect(result).toHaveLength(1);
    });

    // STYLIST ajeno a la cita no debe poder acceder al pago
    it('should throw ForbiddenError when stylist does not own the appointment', async () => {
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        getPaymentsByAppointment.execute(validAppointmentId, 'other-stylist-id', 'STYLIST'),
      ).rejects.toThrow(ForbiddenError);

      expect(mockPaymentRepository.findByAppointmentId).not.toHaveBeenCalled();
    });

    // CLIENT dueño de la cita debe poder ver el pago
    it('should allow the owning client to view the payment', async () => {
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);
      mockPaymentRepository.findByAppointmentId.mockResolvedValue(mockPayments);

      const result = await getPaymentsByAppointment.execute(
        validAppointmentId,
        validClientId,
        'CLIENT',
      );

      expect(result).toHaveLength(1);
    });

    // El creador de la cita (userId) también debe poder ver los pagos, aunque no sea el clientId
    it('should allow the appointment creator (userId) to view the payments', async () => {
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);
      mockPaymentRepository.findByAppointmentId.mockResolvedValue(mockPayments);

      const result = await getPaymentsByAppointment.execute(
        validAppointmentId,
        validUserId,
        'CLIENT',
      );

      expect(result).toHaveLength(1);
    });

    // CLIENT ajeno a la cita no debe poder ver los pagos
    it('should throw ForbiddenError when the client does not own the appointment', async () => {
      mockAppointmentRepository.findById.mockResolvedValue(mockAppointment as any);

      await expect(
        getPaymentsByAppointment.execute(validAppointmentId, 'other-client-id', 'CLIENT'),
      ).rejects.toThrow(ForbiddenError);

      expect(mockPaymentRepository.findByAppointmentId).not.toHaveBeenCalled();
    });

    // Debería lanzar NotFoundError si la cita ya no existe (para STYLIST/CLIENT)
    it('should throw NotFoundError when the appointment no longer exists', async () => {
      mockAppointmentRepository.findById.mockResolvedValue(null);

      await expect(
        getPaymentsByAppointment.execute(validAppointmentId, validStylistId, 'STYLIST'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
