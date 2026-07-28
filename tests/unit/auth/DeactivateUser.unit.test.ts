import { DeactivateUser } from '../../../src/modules/auth/application/use-cases/DeactivateUser';
import { IUserRepository } from '../../../src/modules/auth/domain/repositories/IUserRepository';
import { IRoleRepository } from '../../../src/modules/auth/domain/repositories/IRoleRepository';
import { IStylistServiceRepository } from '../../../src/modules/services/domain/repositories/IStylistServiceRepository';
import { IAppointmentRepository } from '../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../src/modules/appointments/domain/repositories/IAppointmentStatusRepository';
import {
  AppointmentStatus,
  AppointmentStatusEnum,
} from '../../../src/modules/appointments/domain/entities/AppointmentStatus';
import { User } from '../../../src/modules/auth/domain/entities/User';
import { Role } from '../../../src/modules/auth/domain/entities/Role';
import { StylistService } from '../../../src/modules/services/domain/entities/StylistService';
import { Appointment } from '../../../src/modules/appointments/domain/entities/Appointment';
import { ValidationError } from '../../../src/shared/exceptions/ValidationError';
import { NotFoundError } from '../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../src/shared/exceptions/BusinessRuleError';
import { generateUuid } from '../../../src/shared/utils/uuid';

describe('DeactivateUser Use Case', () => {
  let useCase: DeactivateUser;
  let mockUserRepository: jest.Mocked<IUserRepository>;
  let mockRoleRepository: jest.Mocked<IRoleRepository>;
  let mockStylistServiceRepository: jest.Mocked<IStylistServiceRepository>;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let mockAppointmentStatusRepository: jest.Mocked<IAppointmentStatusRepository>;

  const validUserId = generateUuid();
  const validRoleId = generateUuid();
  const pendingStatusId = generateUuid();
  const confirmedStatusId = generateUuid();
  const cancelledStatusId = generateUuid();

  const createMockUser = (overrides: Partial<{
    id: string;
    roleId: string;
    isActive: boolean;
    name: string;
    email: string;
  }> = {}): User => {
    return new User(
      overrides.id ?? validUserId,
      overrides.roleId ?? validRoleId,
      overrides.name ?? 'Test User',
      overrides.email ?? 'test@example.com',
      '+5491155551234',
      'hashedpassword123',
      overrides.isActive ?? true,
    );
  };

  const createMockRole = (name: 'ADMIN' | 'STYLIST' | 'CLIENT'): Role => {
    return new Role(validRoleId, name, `Role: ${name}`);
  };

  const createMockAppointment = (statusId: string): Appointment => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    return new Appointment(
      generateUuid(),
      futureDate,
      60,
      validUserId,
      generateUuid(),
      generateUuid(),
      statusId,
      validUserId,
      undefined,
      [generateUuid()],
    );
  };

  const createMockStylistService = (isOffering: boolean): StylistService => {
    return StylistService.fromPersistence(
      validUserId,
      generateUuid(),
      undefined,
      isOffering,
    );
  };

  beforeEach(() => {
    mockUserRepository = {
      findById: jest.fn(),
      findByIdWithRole: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailWithRole: jest.fn(),
      existsByEmail: jest.fn(),
      markEmailAsVerified: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findAll: jest.fn(),
      findByRole: jest.fn(),
    };

    mockRoleRepository = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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

    mockAppointmentRepository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      existsById: jest.fn(),
      findByClientId: jest.fn(),
      findByStylistId: jest.fn(),
      findByClientIdPaginated: jest.fn(),
      countByClientId: jest.fn(),
      findByStylistIdPaginated: jest.fn(),
      countByStylistId: jest.fn(),
      findByUserId: jest.fn(),
      findByStatusId: jest.fn(),
      findByDateRange: jest.fn(),
      findByClientAndDateRange: jest.fn(),
      findByStylistAndDateRange: jest.fn(),
      findConflictingAppointments: jest.fn(),
      findByScheduleId: jest.fn(),
      findByDate: jest.fn(),
      countByStatus: jest.fn(),
      countByDateRange: jest.fn(),
      findUpcomingAppointments: jest.fn(),
      findPendingConfirmation: jest.fn(),
      existsByServiceId: jest.fn(),
    };

    mockAppointmentStatusRepository = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      existsById: jest.fn(),
      existsByName: jest.fn(),
      findTerminalStatuses: jest.fn(),
      findActiveStatuses: jest.fn(),
    };

    useCase = new DeactivateUser(
      mockUserRepository,
      mockRoleRepository,
      mockStylistServiceRepository,
      mockAppointmentRepository,
      mockAppointmentStatusRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    // Debería lanzar error si el userId está vacío
    it('should throw ValidationError for empty userId', async () => {
      await expect(useCase.execute('')).rejects.toThrow(ValidationError);
      await expect(useCase.execute('')).rejects.toThrow('User ID is required');
      expect(mockUserRepository.findById).not.toHaveBeenCalled();
    });

    // Debería lanzar error si el userId no es un UUID válido
    it('should throw ValidationError for invalid UUID format', async () => {
      await expect(useCase.execute('not-a-uuid')).rejects.toThrow(ValidationError);
      await expect(useCase.execute('not-a-uuid')).rejects.toThrow('User ID must be a valid UUID');
    });
  });

  describe('Not Found Handling', () => {
    // Debería lanzar error si el usuario no existe
    it('should throw NotFoundError when user does not exist', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute(validUserId)).rejects.toThrow(NotFoundError);
    });

    // Debería lanzar error si el rol del usuario no existe
    it('should throw NotFoundError when user role does not exist', async () => {
      const user = createMockUser();
      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute(validUserId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('Already Inactive User', () => {
    // No debería permitir desactivar un usuario que ya está inactivo
    it('should throw BusinessRuleError when user is already deactivated', async () => {
      const inactiveUser = createMockUser({ isActive: false });
      mockUserRepository.findById.mockResolvedValue(inactiveUser);

      await expect(useCase.execute(validUserId)).rejects.toThrow(BusinessRuleError);
      await expect(useCase.execute(validUserId)).rejects.toThrow('User is already deactivated');
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('Successful Deactivation — CLIENT Role', () => {
    // CLIENT no tiene cascada, solo se desactiva el usuario
    it('should deactivate user without executing cascade', async () => {
      const user = createMockUser();
      const role = createMockRole('CLIENT');

      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(role);

      const result = await useCase.execute(validUserId);

      expect(result.userId).toBe(validUserId);
      expect(result.cascadeApplied).toBe(false);
      expect(result.cascadeSummary).toBeUndefined();
      expect(mockUserRepository.update).toHaveBeenCalledWith(user);
      expect(user.isActive).toBe(false);
      // No debería consultar repositorios de citas para no-estilistas
      expect(mockAppointmentRepository.findByStylistId).not.toHaveBeenCalled();
    });
  });

  describe('Successful Deactivation — ADMIN Role', () => {
    // ADMIN tampoco tiene cascada
    it('should deactivate user without executing cascade', async () => {
      const user = createMockUser();
      const role = createMockRole('ADMIN');

      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(role);

      const result = await useCase.execute(validUserId);

      expect(result.cascadeApplied).toBe(false);
      expect(result.cascadeSummary).toBeUndefined();
      expect(mockAppointmentRepository.findByStylistId).not.toHaveBeenCalled();
    });
  });

  describe('Successful Deactivation — STYLIST Role with Cascade', () => {
    // Cancela citas activas (PENDING/CONFIRMED) y desactiva servicios del estilista
    it('should cancel active appointments and deactivate stylist services', async () => {
      const user = createMockUser();
      const role = createMockRole('STYLIST');

      const pendingAppointment = createMockAppointment(pendingStatusId);
      const confirmedAppointment = createMockAppointment(confirmedStatusId);
      const completedAppointment = createMockAppointment(generateUuid()); // no activa

      const activeService1 = createMockStylistService(true);
      const activeService2 = createMockStylistService(true);
      const inactiveService = createMockStylistService(false);

      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(role);

      // Statuses
      mockAppointmentStatusRepository.findByName.mockImplementation(async (name: string) => {
        if (name === AppointmentStatusEnum.CANCELLED) return new AppointmentStatus(cancelledStatusId, name);
        if (name === AppointmentStatusEnum.PENDING) return new AppointmentStatus(pendingStatusId, name);
        if (name === AppointmentStatusEnum.CONFIRMED) return new AppointmentStatus(confirmedStatusId, name);
        return null;
      });

      // Citas del estilista (incluye activas y completada)
      mockAppointmentRepository.findByStylistId.mockResolvedValue([
        pendingAppointment,
        confirmedAppointment,
        completedAppointment,
      ]);
      mockAppointmentRepository.update.mockImplementation(async (a) => a);

      // Servicios del estilista (incluye activos e inactivo)
      mockStylistServiceRepository.findByStylist.mockResolvedValue([
        activeService1,
        activeService2,
        inactiveService,
      ]);
      mockStylistServiceRepository.update.mockImplementation(async (ss) => ss);

      const result = await useCase.execute(validUserId);

      expect(result.cascadeApplied).toBe(true);
      expect(result.cascadeSummary).toBeDefined();
      expect(result.cascadeSummary!.appointmentsCancelled).toBe(2); // solo PENDING + CONFIRMED
      expect(result.cascadeSummary!.servicesDeactivated).toBe(2); // solo las que estaban activas

      // Verificar que se actualizaron las citas activas
      expect(mockAppointmentRepository.update).toHaveBeenCalledTimes(2);
      expect(pendingAppointment.statusId).toBe(cancelledStatusId);
      expect(pendingAppointment.cancellationReason).toBe('Stylist deactivated');
      expect(pendingAppointment.cancelledBy).toBe('system');
      expect(confirmedAppointment.statusId).toBe(cancelledStatusId);

      // Verificar que se desactivaron los servicios activos
      expect(mockStylistServiceRepository.update).toHaveBeenCalledTimes(2);
      expect(activeService1.isOffering).toBe(false);
      expect(activeService2.isOffering).toBe(false);
      // El inactivo no cambió
      expect(inactiveService.isOffering).toBe(false);
    });

    // Estilista sin citas ni servicios activos = cascada con conteo 0
    it('should handle stylist with no active appointments or services', async () => {
      const user = createMockUser();
      const role = createMockRole('STYLIST');

      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(role);

      mockAppointmentStatusRepository.findByName.mockImplementation(async (name: string) => {
        if (name === AppointmentStatusEnum.CANCELLED) return new AppointmentStatus(cancelledStatusId, name);
        if (name === AppointmentStatusEnum.PENDING) return new AppointmentStatus(pendingStatusId, name);
        if (name === AppointmentStatusEnum.CONFIRMED) return new AppointmentStatus(confirmedStatusId, name);
        return null;
      });

      mockAppointmentRepository.findByStylistId.mockResolvedValue([]);
      mockStylistServiceRepository.findByStylist.mockResolvedValue([]);

      const result = await useCase.execute(validUserId);

      expect(result.cascadeApplied).toBe(true);
      expect(result.cascadeSummary!.appointmentsCancelled).toBe(0);
      expect(result.cascadeSummary!.servicesDeactivated).toBe(0);
    });
  });

  describe('Response DTO', () => {
    // Verifica que el DTO de respuesta tiene los datos correctos del usuario
    it('should return correct user data in response', async () => {
      const user = createMockUser({ name: 'Fernando Test', email: 'fernando@test.com' });
      const role = createMockRole('CLIENT');

      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(role);

      const result = await useCase.execute(validUserId);

      expect(result.userId).toBe(validUserId);
      expect(result.email).toBe('fernando@test.com');
      expect(result.name).toBe('Fernando Test');
      expect(result.cascadeApplied).toBe(false);
    });
  });

  describe('Repository Integration', () => {
    // Verifica que se llama a update con el usuario ya desactivado
    it('should call userRepository.update with deactivated user', async () => {
      const user = createMockUser();
      const role = createMockRole('CLIENT');

      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(role);

      await useCase.execute(validUserId);

      expect(mockUserRepository.update).toHaveBeenCalledTimes(1);
      const updatedUser = mockUserRepository.update.mock.calls[0][0];
      expect(updatedUser.isActive).toBe(false);
    });

    // Verifica que busca el rol con el roleId del usuario
    it('should look up role using the user roleId', async () => {
      const user = createMockUser();
      const role = createMockRole('CLIENT');

      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.update.mockResolvedValue(user);
      mockRoleRepository.findById.mockResolvedValue(role);

      await useCase.execute(validUserId);

      expect(mockRoleRepository.findById).toHaveBeenCalledWith(validRoleId);
    });
  });
});
