import { UpdateAppointment } from '../../../../../src/modules/appointments/application/use-cases/UpdateAppointment';
import { IAppointmentRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../../../src/modules/appointments/domain/repositories/IAppointmentStatusRepository';
import { IServiceRepository } from '../../../../../src/modules/services/domain/repositories/IServiceRepository';
import { IStylistServiceRepository } from '../../../../../src/modules/services/domain/repositories/IStylistServiceRepository';
import { UserRoleValidationService } from '../../../../../src/modules/auth/domain/services/UserRoleValidationService';
import { ScheduleAvailabilityService } from '../../../../../src/modules/appointments/domain/services/ScheduleAvailabilityService';
import { Appointment } from '../../../../../src/modules/appointments/domain/entities/Appointment';
import {
  AppointmentStatus,
  AppointmentStatusEnum,
} from '../../../../../src/modules/appointments/domain/entities/AppointmentStatus';
import { Service } from '../../../../../src/modules/services/domain/entities/Service';
import { UpdateAppointmentDto } from '../../../../../src/modules/appointments/application/dto/request/UpdateAppointmentDto';
import { ValidationError } from '../../../../../src/shared/exceptions/ValidationError';
import { NotFoundError } from '../../../../../src/shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../../src/shared/exceptions/ForbiddenError';
import { ConflictError } from '../../../../../src/shared/exceptions/ConflictError';
import { generateUuid } from '../../../../../src/shared/utils/uuid';

describe('UpdateAppointment Use Case', () => {
  let useCase: UpdateAppointment;
  let mockAppointmentRepository: jest.Mocked<IAppointmentRepository>;
  let mockAppointmentStatusRepository: jest.Mocked<IAppointmentStatusRepository>;
  let mockServiceRepository: jest.Mocked<IServiceRepository>;
  let mockUserRoleValidationService: jest.Mocked<UserRoleValidationService>;
  let mockScheduleAvailabilityService: jest.Mocked<ScheduleAvailabilityService>;
  let mockStylistServiceRepository: jest.Mocked<IStylistServiceRepository>;

  const getFutureDate = (hoursFromNow: number = 48): Date => {
    const future = new Date();
    future.setHours(future.getHours() + hoursFromNow);
    // Fija una hora del dia segura (10:00 UTC) para que la cita nunca cruce el
    // fin de jornada del horario simulado. Sin esto, correr la suite de noche
    // (UTC tardio) hacia que la cita terminara despues de las 23:59 y disparara
    // BusinessRuleError('ends after working hours'), volviendo estos tests flaky.
    future.setUTCHours(10, 0, 0, 0);
    return future;
  };

  const getFutureISOString = (hoursFromNow: number = 48): string => {
    return getFutureDate(hoursFromNow).toISOString();
  };

  const validAppointmentId = generateUuid();
  const validRequesterId = generateUuid();
  const validUserId = generateUuid();
  const validClientId = generateUuid();
  const validStylistId = generateUuid();
  const validNewStylistId = generateUuid();
  const validScheduleId = generateUuid();
  const validConfirmedStatusId = generateUuid();
  const validServiceId1 = generateUuid();
  const validNewServiceId = generateUuid();

  const adminRole = 'ADMIN';

  const minimalUpdateDto: UpdateAppointmentDto = { notes: 'Minor update' };

  const createMockAppointment = (overrides: any = {}): Appointment => {
    const baseData = {
      id: validAppointmentId,
      dateTime: getFutureDate(48),
      duration: 60,
      userId: validUserId,
      clientId: validClientId,
      scheduleId: validScheduleId,
      statusId: validConfirmedStatusId,
      stylistId: validStylistId,
      serviceIds: [validServiceId1],
      confirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    return new Appointment(
      baseData.id,
      baseData.dateTime,
      baseData.duration,
      baseData.userId,
      baseData.clientId,
      baseData.scheduleId,
      baseData.statusId,
      baseData.stylistId,
      baseData.confirmedAt,
      baseData.serviceIds,
      baseData.createdAt,
      baseData.updatedAt,
    );
  };

  const createMockAppointmentStatus = (
    name: string,
    id: string = generateUuid(),
  ): AppointmentStatus => {
    return new AppointmentStatus(id, name, `Status: ${name}`);
  };

  const createMockService = (id: string = generateUuid()): Service => {
    const categoryId = generateUuid();
    return {
      id,
      categoryId,
      name: `Service ${id.slice(-4)}`,
      description: 'Mock service description',
      duration: 60,
      durationVariation: 15,
      price: 10000,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      validate: jest.fn(),
      updateDetails: jest.fn(),
      updateCategory: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
      calculateMinDuration: jest.fn().mockReturnValue(45),
      calculateMaxDuration: jest.fn().mockReturnValue(75),
      getFormattedPrice: jest.fn().mockReturnValue('100.00'),
      toPersistence: jest.fn(),
    } as unknown as Service;
  };

  const setupBasicSuccessfulMocks = (appointment: Appointment) => {
    const confirmedStatus = createMockAppointmentStatus(
      AppointmentStatusEnum.CONFIRMED,
      validConfirmedStatusId,
    );
    mockAppointmentRepository.findById.mockResolvedValue(appointment);
    mockAppointmentStatusRepository.findById.mockResolvedValue(confirmedStatus);
    mockAppointmentRepository.findConflictingAppointments.mockResolvedValue([]);
    mockAppointmentRepository.update.mockResolvedValue(appointment);
  };

  beforeEach(() => {
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
    } as unknown as jest.Mocked<IServiceRepository>;

    // Mock de UserRoleValidationService (reemplaza el chequeo manual de rol via IUserRepository)
    mockUserRoleValidationService = {
      ensureUserHasRole: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<UserRoleValidationService>;

    // Mock de ScheduleAvailabilityService: por defecto un horario amplio y permisivo (APT-39)
    mockScheduleAvailabilityService = {
      getEffectiveSchedule: jest.fn().mockResolvedValue({
        startTime: '00:00',
        endTime: '23:59',
        source: 'regular',
      }),
      isDayClosed: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<ScheduleAvailabilityService>;

    // Mock de IStylistServiceRepository: por defecto el estilista ofrece cualquier servicio (APT-29)
    mockStylistServiceRepository = {
      findByStylistAndService: jest.fn().mockResolvedValue({ isOffering: true }),
      findByStylist: jest.fn(),
      findByService: jest.fn(),
      findActiveOfferings: jest.fn(),
      findStylistsOfferingService: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      existsAssignment: jest.fn(),
    } as unknown as jest.Mocked<IStylistServiceRepository>;

    // Defaults para la revalidación de límite diario al reprogramar (APT-39)
    mockAppointmentRepository.findByClientAndDateRange.mockResolvedValue([]);
    mockAppointmentStatusRepository.findByName.mockResolvedValue(null);

    useCase = new UpdateAppointment(
      mockAppointmentRepository,
      mockAppointmentStatusRepository,
      mockServiceRepository,
      mockUserRoleValidationService,
      mockScheduleAvailabilityService,
      mockStylistServiceRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Execution', () => {
    // Debería actualizar la cita exitosamente con datos completos
    it('should update appointment successfully with complete data', async () => {
      const completeUpdateDto: UpdateAppointmentDto = {
        dateTime: getFutureISOString(72),
        duration: 90,
        stylistId: validNewStylistId,
        serviceIds: [validNewServiceId],
        notes: 'Updated due to client request',
        reason: 'Client preferred different time',
        notifyClient: true,
      };
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      jest.spyOn(appointment, 'isConfirmed').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      mockServiceRepository.findById.mockResolvedValue(createMockService(validNewServiceId));

      const result = await useCase.execute(
        validAppointmentId,
        completeUpdateDto,
        validRequesterId,
        adminRole,
      );

      expect(mockAppointmentRepository.findById).toHaveBeenCalledWith(validAppointmentId);
      expect(result.id).toBe(appointment.id);
    });

    // Debería actualizar la cita exitosamente con cambios mínimos
    it('should update appointment successfully with minimal changes', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      const result = await useCase.execute(
        validAppointmentId,
        minimalUpdateDto,
        validRequesterId,
        adminRole,
      );

      expect(result.id).toBe(appointment.id);
      expect(mockUserRoleValidationService.ensureUserHasRole).not.toHaveBeenCalled();
    });

    // Debería permitir la actualización por parte del estilista asignado
    it('should allow update by assigned stylist', async () => {
      const appointment = createMockAppointment({
        stylistId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      const result = await useCase.execute(
        validAppointmentId,
        minimalUpdateDto,
        validRequesterId,
        'STYLIST',
      );
      expect(result.id).toBe(appointment.id);
    });

    // Debería permitir al clientId actualizar la cita
    it('should allow update by clientId', async () => {
      const appointment = createMockAppointment({
        clientId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      const result = await useCase.execute(
        validAppointmentId,
        minimalUpdateDto,
        validRequesterId,
        'CLIENT',
      );
      expect(result.id).toBe(appointment.id);
    });

    // Debería permitir ADMIN actualizar cualquier cita
    it('should allow ADMIN to update any appointment', async () => {
      const unrelatedAdminId = generateUuid();
      const appointment = createMockAppointment({ dateTime: getFutureDate(96) });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      const result = await useCase.execute(
        validAppointmentId,
        minimalUpdateDto,
        unrelatedAdminId,
        'ADMIN',
      );
      expect(result.id).toBe(appointment.id);
    });
  });

  describe('Input Validation', () => {
    // Debería lanzar error si el appointmentId está vacío
    it('should throw error for empty appointmentId', async () => {
      await expect(
        useCase.execute('', minimalUpdateDto, validRequesterId, adminRole),
      ).rejects.toThrow(new ValidationError('Appointment ID is required'));
    });

    // Debería lanzar error si el formato UUID del appointmentId es inválido
    it('should throw error for invalid appointmentId UUID format', async () => {
      await expect(
        useCase.execute('invalid-uuid', minimalUpdateDto, validRequesterId, adminRole),
      ).rejects.toThrow(new ValidationError('Appointment ID must be a valid UUID'));
    });

    // Debería lanzar error si no se proporciona ningún campo para actualizar
    it('should throw error if no fields provided for update', async () => {
      const emptyDto: UpdateAppointmentDto = {};
      await expect(
        useCase.execute(validAppointmentId, emptyDto, validRequesterId, adminRole),
      ).rejects.toThrow(new ValidationError('At least one field must be provided for update'));
    });

    // Debería lanzar error si la fecha/hora está en el pasado
    it('should throw error for past dateTime', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);
      const pastDateDto: UpdateAppointmentDto = { dateTime: pastDate.toISOString() };
      await expect(
        useCase.execute(validAppointmentId, pastDateDto, validRequesterId, adminRole),
      ).rejects.toThrow(new ValidationError('Appointment cannot be rescheduled to the past'));
    });

    // Debería lanzar error para valores de duración inválidos
    it('should throw error for invalid duration values', async () => {
      const testCases = [
        { duration: 0, expectedError: 'Duration must be greater than 0' },
        { duration: 10, expectedError: 'Minimum appointment duration is 15 minutes' },
        { duration: 500, expectedError: 'Maximum appointment duration is 8 hours' },
        { duration: 22, expectedError: 'Duration must be in 15-minute increments' },
      ];
      for (const testCase of testCases) {
        const invalidDurationDto: UpdateAppointmentDto = { duration: testCase.duration };
        await expect(
          useCase.execute(validAppointmentId, invalidDurationDto, validRequesterId, adminRole),
        ).rejects.toThrow(new ValidationError(testCase.expectedError));
      }
    });

    // Debería lanzar error si las notas son demasiado largas
    it('should throw error for notes too long', async () => {
      const longNotesDto: UpdateAppointmentDto = { notes: 'x'.repeat(501) };
      await expect(
        useCase.execute(validAppointmentId, longNotesDto, validRequesterId, adminRole),
      ).rejects.toThrow(new ValidationError('Notes cannot exceed 500 characters'));
    });
  });

  describe('Business Rules Validation', () => {
    // Debería lanzar ForbiddenError para un usuario sin permisos
    // (usa rol CLIENT para que no tenga ADMIN override)
    it('should throw ForbiddenError for user without permissions', async () => {
      const unauthorizedUserId = generateUuid();
      const appointment = createMockAppointment({ userId: validUserId, stylistId: validStylistId });
      mockAppointmentRepository.findById.mockResolvedValue(appointment);

      await expect(
        useCase.execute(validAppointmentId, minimalUpdateDto, unauthorizedUserId, 'CLIENT'),
      ).rejects.toThrow(
        new ForbiddenError('You do not have permission to update this appointment'),
      );
    });

    // Debería lanzar BusinessRuleError para citas en estado terminal
    it('should throw BusinessRuleError for terminal status appointments', async () => {
      const terminalStatuses = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];
      for (const statusName of terminalStatuses) {
        const statusId = generateUuid();
        const appointment = createMockAppointment({ userId: validRequesterId, statusId });
        const terminalStatus = createMockAppointmentStatus(statusName, statusId);
        mockAppointmentRepository.findById.mockResolvedValue(appointment);
        mockAppointmentStatusRepository.findById.mockResolvedValue(terminalStatus);

        await expect(
          useCase.execute(validAppointmentId, minimalUpdateDto, validRequesterId, adminRole),
        ).rejects.toThrow(new BusinessRuleError('Cannot update appointments in terminal status'));
        jest.clearAllMocks();
      }
    });

    // Debería exigir una nota al cambiar la fecha/hora de una cita confirmada
    it('should require note for dateTime changes in confirmed appointments', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      const confirmedStatus = createMockAppointmentStatus(AppointmentStatusEnum.CONFIRMED);
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      jest.spyOn(appointment, 'isConfirmed').mockReturnValue(true);
      mockAppointmentRepository.findById.mockResolvedValue(appointment);
      mockAppointmentStatusRepository.findById.mockResolvedValue(confirmedStatus);

      const dateOnlyDto: UpdateAppointmentDto = { dateTime: getFutureISOString(120) };
      await expect(
        useCase.execute(validAppointmentId, dateOnlyDto, validRequesterId, adminRole),
      ).rejects.toThrow(
        new BusinessRuleError(
          'A note or reason is required when changing the date/time of a confirmed appointment',
        ),
      );
    });

    // Debería lanzar BusinessRuleError si la modificación es demasiado tardía
    it('should throw BusinessRuleError for too late modifications', async () => {
      const appointment = createMockAppointment({ userId: validRequesterId });
      const confirmedStatus = createMockAppointmentStatus(AppointmentStatusEnum.CONFIRMED);
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(false);
      mockAppointmentRepository.findById.mockResolvedValue(appointment);
      mockAppointmentStatusRepository.findById.mockResolvedValue(confirmedStatus);

      await expect(
        useCase.execute(validAppointmentId, minimalUpdateDto, validRequesterId, adminRole),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('Not Found Handling', () => {
    // Debería lanzar NotFoundError si la cita no existe
    it('should throw NotFoundError when appointment does not exist', async () => {
      mockAppointmentRepository.findById.mockResolvedValue(null);
      await expect(
        useCase.execute(validAppointmentId, minimalUpdateDto, validRequesterId, adminRole),
      ).rejects.toThrow(new NotFoundError('Appointment', validAppointmentId));
    });

    // Debería lanzar NotFoundError si el estilista no existe
    it('should throw NotFoundError when stylist does not exist', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      const invalidStylistDto: UpdateAppointmentDto = { stylistId: validNewStylistId };
      mockUserRoleValidationService.ensureUserHasRole.mockRejectedValue(
        new NotFoundError('Stylist', validNewStylistId),
      );

      await expect(
        useCase.execute(validAppointmentId, invalidStylistDto, validRequesterId, adminRole),
      ).rejects.toThrow(new NotFoundError('Stylist', validNewStylistId));
    });

    // Debería lanzar NotFoundError si el servicio no existe
    it('should throw NotFoundError when service does not exist', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      const invalidServiceDto: UpdateAppointmentDto = { serviceIds: [validNewServiceId] };
      mockServiceRepository.findById.mockResolvedValue(null);

      await expect(
        useCase.execute(validAppointmentId, invalidServiceDto, validRequesterId, adminRole),
      ).rejects.toThrow(new NotFoundError('Service', validNewServiceId));
    });
  });

  describe('Conflict Detection', () => {
    // Debería lanzar ConflictError por conflictos de horario
    it('should throw ConflictError for scheduling conflicts', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      const conflictingAppointment = createMockAppointment({ id: generateUuid() });
      const confirmedStatus = createMockAppointmentStatus(AppointmentStatusEnum.CONFIRMED);
      mockAppointmentRepository.findById.mockResolvedValue(appointment);
      mockAppointmentStatusRepository.findById.mockResolvedValue(confirmedStatus);
      mockAppointmentRepository.findConflictingAppointments.mockResolvedValue([
        conflictingAppointment,
      ]);

      const dateTimeUpdateDto: UpdateAppointmentDto = {
        dateTime: getFutureISOString(96),
        notes: 'Reschedule',
      };
      await expect(
        useCase.execute(validAppointmentId, dateTimeUpdateDto, validRequesterId, adminRole),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Repository Integration', () => {
    // Debería llamar a los repositorios con los parámetros correctos
    it('should call repositories with correct parameters', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      await useCase.execute(validAppointmentId, minimalUpdateDto, validRequesterId, adminRole);

      expect(mockAppointmentRepository.findById).toHaveBeenCalledWith(validAppointmentId);
      expect(mockAppointmentRepository.update).toHaveBeenCalledWith(appointment);
    });
  });

  describe('APT-39: Effective Schedule Revalidation on Reschedule', () => {
    // Debería lanzar BusinessRuleError si la nueva fecha cae en un día cerrado (feriado)
    it('should throw BusinessRuleError when the new date falls on a closed day (holiday)', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      mockScheduleAvailabilityService.getEffectiveSchedule.mockResolvedValue(null);

      const rescheduleDto: UpdateAppointmentDto = {
        dateTime: getFutureISOString(120),
        notes: 'Reschedule to closed day',
      };

      await expect(
        useCase.execute(validAppointmentId, rescheduleDto, validRequesterId, adminRole),
      ).rejects.toThrow(
        new BusinessRuleError(
          'The salon is closed on the selected date (holiday or no schedule available)',
        ),
      );
    });

    // Debería lanzar BusinessRuleError si el horario reprogramado cae fuera del horario laboral
    it('should throw BusinessRuleError when the rescheduled time falls outside working hours', async () => {
      const futureDate = getFutureDate(96);
      // Fuerza una hora (UTC) fuera del rango de horario efectivo simulado (09:00-17:00)
      futureDate.setUTCHours(20, 0, 0, 0);
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(48),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      mockScheduleAvailabilityService.getEffectiveSchedule.mockResolvedValue({
        startTime: '09:00',
        endTime: '17:00',
        source: 'regular',
      });

      const rescheduleDto: UpdateAppointmentDto = {
        dateTime: futureDate.toISOString(),
        notes: 'Reschedule outside working hours',
      };

      await expect(
        useCase.execute(validAppointmentId, rescheduleDto, validRequesterId, adminRole),
      ).rejects.toThrow(BusinessRuleError);
    });

    // Debería lanzar BusinessRuleError si se alcanza el límite diario de citas en la nueva fecha
    it('should throw BusinessRuleError when the daily appointment limit is reached on the new date', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      const otherAppointment1 = createMockAppointment({ id: generateUuid() });
      const otherAppointment2 = createMockAppointment({ id: generateUuid() });
      const otherAppointment3 = createMockAppointment({ id: generateUuid() });
      mockAppointmentRepository.findByClientAndDateRange.mockResolvedValue([
        otherAppointment1,
        otherAppointment2,
        otherAppointment3,
      ]);

      const rescheduleDto: UpdateAppointmentDto = {
        dateTime: getFutureISOString(120),
        notes: 'Reschedule hitting daily limit',
      };

      await expect(
        useCase.execute(validAppointmentId, rescheduleDto, validRequesterId, adminRole),
      ).rejects.toThrow(
        new BusinessRuleError('Maximum of 3 appointments per day has been reached'),
      );
    });

    // Debería excluir la propia cita del conteo del límite diario
    it('should exclude the appointment itself from the daily limit count', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      // La propia cita ya existe en el rango de fechas consultado; no debe contarse a sí misma
      mockAppointmentRepository.findByClientAndDateRange.mockResolvedValue([appointment]);

      const rescheduleDto: UpdateAppointmentDto = {
        dateTime: getFutureISOString(120),
        notes: 'Reschedule same day',
      };

      const result = await useCase.execute(
        validAppointmentId,
        rescheduleDto,
        validRequesterId,
        adminRole,
      );

      expect(result.id).toBe(appointment.id);
    });
  });

  describe('APT-29: Service Offering Revalidation on Update', () => {
    // Debería lanzar BusinessRuleError si un servicio actualizado ya no está activo
    it('should throw BusinessRuleError when an updated service is no longer active', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      const inactiveService = createMockService(validNewServiceId);
      (inactiveService as any).isActive = false;
      mockServiceRepository.findById.mockResolvedValue(inactiveService);

      const updateServicesDto: UpdateAppointmentDto = { serviceIds: [validNewServiceId] };

      await expect(
        useCase.execute(validAppointmentId, updateServicesDto, validRequesterId, adminRole),
      ).rejects.toThrow(BusinessRuleError);
    });

    // Debería lanzar BusinessRuleError si el estilista asignado no ofrece el servicio actualizado
    it('should throw BusinessRuleError when the assigned stylist does not offer the updated service', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
        stylistId: validStylistId,
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      mockServiceRepository.findById.mockResolvedValue(createMockService(validNewServiceId));
      mockStylistServiceRepository.findByStylistAndService.mockResolvedValue(null);

      const updateServicesDto: UpdateAppointmentDto = { serviceIds: [validNewServiceId] };

      await expect(
        useCase.execute(validAppointmentId, updateServicesDto, validRequesterId, adminRole),
      ).rejects.toThrow(
        new BusinessRuleError('Stylist does not offer one of the selected services'),
      );
    });

    // Debería lanzar BusinessRuleError si el estilista dejó de ofrecer el servicio actualizado
    it('should throw BusinessRuleError when the stylist has stopped offering the updated service', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
        stylistId: validStylistId,
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);
      mockServiceRepository.findById.mockResolvedValue(createMockService(validNewServiceId));
      mockStylistServiceRepository.findByStylistAndService.mockResolvedValue({
        isOffering: false,
      } as any);

      const updateServicesDto: UpdateAppointmentDto = { serviceIds: [validNewServiceId] };

      await expect(
        useCase.execute(validAppointmentId, updateServicesDto, validRequesterId, adminRole),
      ).rejects.toThrow(
        new BusinessRuleError('Stylist is not currently offering one of the selected services'),
      );
    });
  });

  describe('Data Mapping', () => {
    // Debería mapear las fechas al formato ISO string
    it('should map dates to ISO string format', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      const result = await useCase.execute(
        validAppointmentId,
        minimalUpdateDto,
        validRequesterId,
        adminRole,
      );

      expect(result.dateTime).toBe(appointment.dateTime.toISOString());
      expect(result.createdAt).toBe(appointment.createdAt.toISOString());
    });

    // Debería mantener intacta la estructura del array
    it('should maintain array structure intact', async () => {
      const appointment = createMockAppointment({
        userId: validRequesterId,
        dateTime: getFutureDate(96),
        serviceIds: ['service1', 'service2', 'service3'],
      });
      jest.spyOn(appointment, 'canBeModified').mockReturnValue(true);
      setupBasicSuccessfulMocks(appointment);

      const result = await useCase.execute(
        validAppointmentId,
        minimalUpdateDto,
        validRequesterId,
        adminRole,
      );

      expect(Array.isArray(result.serviceIds)).toBe(true);
      expect(result.serviceIds).toHaveLength(3);
    });
  });
});
