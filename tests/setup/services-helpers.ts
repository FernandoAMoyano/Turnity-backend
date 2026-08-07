import request from 'supertest';
import app from '../../src/app';
import { testPrisma } from './database';

export interface TestCategory {
  id: string;
  name: string;
  description?: string;
}

export interface TestService {
  id: string;
  name: string;
  description: string;
  duration: number;
  durationVariation: number;
  price: number;
  categoryId: string;
}

// Helper para generar nombres válidos (solo letras y espacios)
const generateValidName = (prefix: string): string => {
  const timestamp = Date.now().toString();
  const letters = timestamp.replace(/[0-9]/g, (digit) => {
    const letterMap: { [key: string]: string } = {
      '0': 'A',
      '1': 'B',
      '2': 'C',
      '3': 'D',
      '4': 'E',
      '5': 'F',
      '6': 'G',
      '7': 'H',
      '8': 'I',
      '9': 'J',
    };
    return letterMap[digit];
  });
  return `${prefix} ${letters}`;
};

//Crea una categoría de test

export const createTestCategory = async (
  adminToken: string,
  customData?: Partial<{
    name: string;
    description: string;
  }>,
): Promise<TestCategory> => {
  const categoryData = {
    name: generateValidName('Test Category'),
    description: 'Test category for integration tests',
    ...customData,
  };

  const response = await request(app)
    .post('/api/v1/categories')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(categoryData);

  if (response.status !== 201) {
    throw new Error(
      `Failed to create test category: ${response.status} - ${response.body?.message}`,
    );
  }

  return response.body.data;
};

//Crea un servicio de test

export const createTestService = async (
  adminToken: string,
  categoryId: string,
  customData?: Partial<{
    name: string;
    description: string;
    duration: number;
    durationVariation: number;
    price: number;
  }>,
): Promise<TestService> => {
  const serviceData = {
    categoryId,
    name: generateValidName('Test Service'),
    description: 'Test service for integration tests',
    duration: 60,
    durationVariation: 15,
    price: 50.0,
    ...customData,
  };

  const response = await request(app)
    .post('/api/v1/services')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(serviceData);

  if (response.status !== 201) {
    throw new Error(
      `Failed to create test service: ${response.status} - ${response.body?.message}`,
    );
  }

  return response.body.data;
};

//Crea múltiples servicios de test

export const createMultipleTestServices = async (
  adminToken: string,
  categoryId: string,
  count: number = 3,
): Promise<TestService[]> => {
  const services: TestService[] = [];

  for (let i = 0; i < count; i++) {
    const service = await createTestService(adminToken, categoryId, {
      name: generateValidName(`Test Service ${String.fromCharCode(65 + i)}`), // A, B, C...
      duration: 30 + i * 15,
      price: 25.0 + i * 10,
    });
    services.push(service);
  }

  return services;
};

//Crea un estilista de test
export const createTestStylist = async (): Promise<{
  userId: string;
  stylistId: string;
  user: any;
}> => {
  // Crear usuario con rol STYLIST usando el endpoint
  const userResponse = await request(app)
    .post('/api/v1/auth/register')
    .send({
      name: 'Test Stylist User',
      email: `stylist${Date.now()}@test.com`,
      phone: '+1234567890',
      password: 'TestPass123!',
      roleName: 'STYLIST',
    });

  if (userResponse.status !== 201) {
    throw new Error(`Failed to create test stylist user: ${userResponse.status}`);
  }

  // Gating de login activo en test: verificar el email con el devToken (expuesto en test)
  const devToken = userResponse.body.devToken;
  if (devToken) {
    await request(app).post('/api/v1/auth/verify-email').send({ token: devToken });
  }

  const user = userResponse.body.data;

  // StylistService.stylistId ahora es User.id directamente, no se necesita tabla Stylist
  return {
    userId: user.id,
    stylistId: user.id,
    user,
  };
};

//Limpia todos los datos de test
export const cleanupTestData = async (): Promise<void> => {
  try {
    console.log('🧹 Starting test data cleanup...');

    // 0. Obtener IDs de usuarios de test primero -- se necesitan para las tablas
    // que referencian User sin cascada (Appointment, Notification) antes de poder
    // borrar los Users mismos sin violar la FK constraint
    const testUsers = await testPrisma.user.findMany({
      where: { email: { contains: 'test' } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    if (testUserIds.length > 0) {
      // 0a. Appointment.userId/clientId/stylistId -> User, sin cascada.
      // Payment.appointmentId -> Appointment, sin cascada: hay que borrar
      // los Payments de esas citas antes que las citas mismas.
      const testAppointments = await testPrisma.appointment.findMany({
        where: {
          OR: [
            { userId: { in: testUserIds } },
            { clientId: { in: testUserIds } },
            { stylistId: { in: testUserIds } },
          ],
        },
        select: { id: true },
      });
      const testAppointmentIds = testAppointments.map((a) => a.id);

      if (testAppointmentIds.length > 0) {
        await testPrisma.payment.deleteMany({
          where: { appointmentId: { in: testAppointmentIds } },
        });
        await testPrisma.appointment.deleteMany({
          where: { id: { in: testAppointmentIds } },
        });
      }

      // 0b. Notification.userId -> User, sin cascada.
      await testPrisma.notification.deleteMany({
        where: { userId: { in: testUserIds } },
      });
    }

    // 1. Eliminar asignaciones StylistService de test
    await testPrisma.stylistService.deleteMany({
      where: {
        OR: [
          { stylist: { email: { contains: 'test' } } },
          { service: { name: { contains: 'Test' } } },
          { service: { category: { name: { contains: 'Test' } } } },
        ],
      },
    });

    // 2. Eliminar Services de test
    await testPrisma.service.deleteMany({
      where: {
        OR: [
          { name: { contains: 'Test' } },
          { category: { name: { contains: 'Test' } } },
          { category: { name: { contains: 'Another' } } },
          { category: { name: { contains: 'Delete' } } },
          { category: { name: { contains: 'Status' } } },
          { category: { name: { contains: 'Original' } } },
        ],
      },
    });

    // 3. Eliminar Categories de test
    await testPrisma.category.deleteMany({
      where: {
        OR: [
          { name: { contains: 'Test' } },
          { name: { contains: 'Another' } },
          { name: { contains: 'Delete' } },
          { name: { contains: 'Status' } },
          { name: { contains: 'Original' } },
          { name: { contains: 'Minimal' } },
          { name: { contains: 'Updated' } },
          { name: { contains: 'Duplicate' } },
        ],
      },
    });

    // 4. Eliminar Users de test
    await testPrisma.user.deleteMany({
      where: {
        email: { contains: 'test' },
      },
    });

    console.log('✅ Test data cleanup completed');
  } catch (error) {
    console.warn('⚠️ Cleanup warning:', error);
  }
};

//Espera un tiempo determinado

export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

//Genera datos de servicio válidos para tests

export const generateValidServiceData = (categoryId: string, customData?: any) => {
  return {
    categoryId,
    name: generateValidName('Test Service'),
    description: 'Test service description for integration tests',
    duration: 60,
    durationVariation: 15,
    price: 50.0,
    ...customData,
  };
};

//Genera datos de categoría válidos para tests

export const generateValidCategoryData = (customData?: any) => {
  return {
    name: generateValidName('Test Category'),
    description: 'Test category description for integration tests',
    ...customData,
  };
};

//Verifica la estructura de respuesta de un servicio

export const validateServiceResponse = (service: any): void => {
  expect(service).toHaveProperty('id');
  expect(service).toHaveProperty('name');
  expect(service).toHaveProperty('description');
  expect(service).toHaveProperty('duration');
  expect(service).toHaveProperty('durationVariation');
  expect(service).toHaveProperty('price');
  expect(service).toHaveProperty('formattedPrice');
  expect(service).toHaveProperty('minDuration');
  expect(service).toHaveProperty('maxDuration');
  expect(service).toHaveProperty('isActive');
  expect(service).toHaveProperty('category');
  expect(service).toHaveProperty('createdAt');
  expect(service).toHaveProperty('updatedAt');

  expect(service.category).toHaveProperty('id');
  expect(service.category).toHaveProperty('name');
  expect(service.category).toHaveProperty('isActive');
};

// Verifica la estructura de respuesta de una categoría

export const validateCategoryResponse = (category: any): void => {
  expect(category).toHaveProperty('id');
  expect(category).toHaveProperty('name');
  expect(category).toHaveProperty('isActive');
  expect(category).toHaveProperty('createdAt');
  expect(category).toHaveProperty('updatedAt');
};

//Generar nombres únicos con solo letras y espacios
export const generateUniqueName = (baseName: string): string => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let randomLetters = '';
  for (let i = 0; i < 6; i++) {
    randomLetters += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return `${baseName} ${randomLetters}`;
};

// ==============================================================
//    HELPERS ESPECÍFICOS PARA ASIGNACIONES ESTILISTA-SERVICIO
// ==============================================================

//Asigna un servicio a un estilista

export const assignServiceToStylist = async (
  adminToken: string,
  stylistId: string,
  serviceId: string,
  customPrice?: number,
): Promise<any> => {
  const assignData: any = {
    serviceId,
  };

  if (customPrice !== undefined) {
    assignData.customPrice = customPrice;
  }

  const response = await request(app)
    .post(`/api/v1/services/stylists/${stylistId}/services`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(assignData);

  if (response.status !== 201) {
    throw new Error(
      `Failed to assign service to stylist: ${response.status} - ${response.body?.message}`,
    );
  }

  return response.body.data;
};

//Actualiza una asignación estilista-servicio

export const updateStylistServiceAssignment = async (
  adminToken: string,
  stylistId: string,
  serviceId: string,
  updateData: {
    customPrice?: number;
    isOffering?: boolean;
  },
): Promise<any> => {
  const response = await request(app)
    .put(`/api/v1/services/stylists/${stylistId}/services/${serviceId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(updateData);

  if (response.status !== 200) {
    throw new Error(
      `Failed to update stylist service: ${response.status} - ${response.body?.message}`,
    );
  }

  return response.body.data;
};

//Remueve un servicio de un estilista

export const removeServiceFromStylist = async (
  adminToken: string,
  stylistId: string,
  serviceId: string,
): Promise<void> => {
  const response = await request(app)
    .delete(`/api/v1/services/stylists/${stylistId}/services/${serviceId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  if (response.status !== 200) {
    throw new Error(
      `Failed to remove service from stylist: ${response.status} - ${response.body?.message}`,
    );
  }
};

//Obtiene los servicios de un estilista

export const getStylistServices = async (stylistId: string): Promise<any[]> => {
  const response = await request(app)
    .get(`/api/v1/services/stylists/${stylistId}/services`)
    .expect(200);

  return response.body.data;
};

//Obtiene los servicios activos de un estilista

export const getStylistActiveServices = async (stylistId: string): Promise<any[]> => {
  const response = await request(app)
    .get(`/api/v1/services/stylists/${stylistId}/services/active`)
    .expect(200);

  return response.body.data;
};

//Obtiene los estilistas que ofrecen un servicio

export const getStylistsOfferingService = async (serviceId: string): Promise<any[]> => {
  const response = await request(app)
    .get(`/api/v1/services/${serviceId}/stylists/offering`)
    .expect(200);

  return response.body.data;
};

//Calcula el precio efectivo esperado

export const calculateExpectedEffectivePrice = (
  basePrice: number,
  customPrice?: number | null,
): number => {
  // F5: customPrice viaja como null (no undefined) cuando no hay precio personalizado
  return customPrice !== undefined && customPrice !== null ? customPrice : basePrice;
};

//Formatea el precio como string (centavos a decimales, patron Stripe, ver F2)

export const formatPrice = (priceInCents: number): string => {
  return (priceInCents / 100).toFixed(2);
};

//Verifica la estructura completa de respuesta StylistServiceDto

export const validateStylistServiceResponse = (assignment: any): void => {
  expect(assignment).toHaveProperty('stylistId');
  expect(assignment).toHaveProperty('serviceId');
  expect(assignment).toHaveProperty('serviceName');
  expect(assignment).toHaveProperty('serviceDescription');
  expect(assignment).toHaveProperty('baseDuration');
  expect(assignment).toHaveProperty('basePrice');
  expect(assignment).toHaveProperty('effectivePrice');
  expect(assignment).toHaveProperty('formattedEffectivePrice');
  expect(assignment).toHaveProperty('isOffering');
  expect(assignment).toHaveProperty('hasCustomPrice');
  expect(assignment).toHaveProperty('createdAt');
  expect(assignment).toHaveProperty('updatedAt');

  // Validar tipos
  expect(typeof assignment.stylistId).toBe('string');
  expect(typeof assignment.serviceId).toBe('string');
  expect(typeof assignment.serviceName).toBe('string');
  expect(typeof assignment.serviceDescription).toBe('string');
  expect(typeof assignment.baseDuration).toBe('number');
  expect(typeof assignment.basePrice).toBe('number');
  expect(typeof assignment.effectivePrice).toBe('number');
  expect(typeof assignment.formattedEffectivePrice).toBe('string');
  expect(typeof assignment.isOffering).toBe('boolean');
  expect(typeof assignment.hasCustomPrice).toBe('boolean');

  // Validar que effectivePrice sea correcto
  const expectedEffectivePrice = calculateExpectedEffectivePrice(
    assignment.basePrice,
    assignment.customPrice,
  );
  expect(assignment.effectivePrice).toBe(expectedEffectivePrice);

  // Validar formato de precio
  const expectedFormattedPrice = formatPrice(assignment.effectivePrice);
  expect(assignment.formattedEffectivePrice).toBe(expectedFormattedPrice);

  // Validar hasCustomPrice
  const expectedHasCustomPrice =
    assignment.customPrice !== undefined && assignment.customPrice !== null;
  expect(assignment.hasCustomPrice).toBe(expectedHasCustomPrice);
};

//Verifica la estructura de StylistWithServicesDto

export const validateStylistWithServicesResponse = (stylistWithServices: any): void => {
  expect(stylistWithServices).toHaveProperty('stylistId');
  expect(stylistWithServices).toHaveProperty('stylistName');
  expect(stylistWithServices).toHaveProperty('stylistEmail');
  expect(stylistWithServices).toHaveProperty('services');
  expect(stylistWithServices).toHaveProperty('totalServicesOffered');

  expect(typeof stylistWithServices.stylistId).toBe('string');
  expect(typeof stylistWithServices.stylistName).toBe('string');
  expect(typeof stylistWithServices.stylistEmail).toBe('string');
  expect(Array.isArray(stylistWithServices.services)).toBe(true);
  expect(typeof stylistWithServices.totalServicesOffered).toBe('number');

  // Validar cada servicio en el array
  stylistWithServices.services.forEach((service: any) => {
    validateStylistServiceResponse(service);
  });

  // Validar que totalServicesOffered sea correcto
  const actualOfferedCount = stylistWithServices.services.filter((s: any) => s.isOffering).length;
  expect(stylistWithServices.totalServicesOffered).toBe(actualOfferedCount);
};

//Verifica la estructura de ServiceWithStylistsDto

export const validateServiceWithStylistsResponse = (serviceWithStylists: any): void => {
  expect(serviceWithStylists).toHaveProperty('serviceId');
  expect(serviceWithStylists).toHaveProperty('serviceName');
  expect(serviceWithStylists).toHaveProperty('serviceDescription');
  expect(serviceWithStylists).toHaveProperty('baseDuration');
  expect(serviceWithStylists).toHaveProperty('basePrice');
  expect(serviceWithStylists).toHaveProperty('stylists');
  expect(serviceWithStylists).toHaveProperty('totalStylistsOffering');

  expect(typeof serviceWithStylists.serviceId).toBe('string');
  expect(typeof serviceWithStylists.serviceName).toBe('string');
  expect(typeof serviceWithStylists.serviceDescription).toBe('string');
  expect(typeof serviceWithStylists.baseDuration).toBe('number');
  expect(typeof serviceWithStylists.basePrice).toBe('number');
  expect(Array.isArray(serviceWithStylists.stylists)).toBe(true);
  expect(typeof serviceWithStylists.totalStylistsOffering).toBe('number');

  // Validar cada estilista en el array
  serviceWithStylists.stylists.forEach((stylist: any) => {
    validateStylistServiceResponse(stylist);
  });

  // Validar que totalStylistsOffering sea correcto
  const actualOfferingCount = serviceWithStylists.stylists.filter((s: any) => s.isOffering).length;
  expect(serviceWithStylists.totalStylistsOffering).toBe(actualOfferingCount);
};
