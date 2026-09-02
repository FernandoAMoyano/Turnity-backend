import request from 'supertest';
import app from '../../../src/app';
import {
  loginAsAdmin,
  loginTestUser,
  createTestUser,
  createTestStylist,
} from '../../setup/helpers';
import { createConfirmedTestAppointment } from '../../setup/appointments-helpers';
import { testPrisma } from '../../setup/database';
import { generateUuid } from '../../../src/shared/utils/uuid';

// Tests de integración para el módulo de Pagos
describe('Payments Integration Tests', () => {
  let adminToken: string;
  let userToken: string;
  let clientUserId: string;
  let stylistToken: string;
  let stylistId: string;
  let testAppointmentId: string;
  let testPaymentId: string;

  beforeAll(async () => {
    // Login como admin
    adminToken = await loginAsAdmin();

    // Login como usuario normal (cliente)
    const userData = await loginTestUser();
    userToken = userData.token;
    clientUserId = userData.user.id;

    // Login como estilista
    const stylistResponse = await request(app).post('/api/v1/auth/login').send({
      email: 'lucia@turnity.com',
      password: 'stylist123',
    });
    stylistToken = stylistResponse.body.data.token;
    stylistId = stylistResponse.body.data.user.id;

    // Crear una cita de prueba confirmada para los tests de pagos, asignada
    // explícitamente al estilista de arriba (los tests de "como estilista"
    // más abajo dependen de que sea dueño real de la cita, ver ownership check)
    const appointment = await createConfirmedTestAppointment({ stylistId });
    testAppointmentId = appointment.id;
  });

  // POST /api/v1/payments - Crear pago (Admin, Stylist)
  describe('POST /api/v1/payments - Create Payment', () => {
    // Debería crear un pago como admin
    it('should create a payment as admin', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 50.0,
          appointmentId: testAppointmentId,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.amount).toBe(50.0);
      expect(response.body.data.status).toBe('PENDING');
      expect(response.body.data.method).toBeNull();
      expect(response.body.data.appointmentId).toBe(testAppointmentId);

      // Guardar ID para tests posteriores
      testPaymentId = response.body.data.id;
    });

    // Debería crear un pago como estilista
    it('should create a payment as stylist', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          amount: 75.5,
          appointmentId: testAppointmentId,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.amount).toBe(75.5);
      expect(response.body.data.status).toBe('PENDING');
    });

    // Debería rechazar creación como cliente
    it('should reject creation as client', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          amount: 50.0,
          appointmentId: testAppointmentId,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar creación sin autenticación
    it('should reject creation without authentication', async () => {
      const response = await request(app).post('/api/v1/payments').send({
        amount: 50.0,
        appointmentId: testAppointmentId,
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    // Debería validar monto requerido
    it('should validate amount is required', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          appointmentId: testAppointmentId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería validar monto mayor a 0
    it('should validate amount is greater than 0', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 0,
          appointmentId: testAppointmentId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería validar monto negativo
    it('should validate negative amount', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: -50,
          appointmentId: testAppointmentId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería validar appointmentId requerido
    it('should validate appointmentId is required', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 50.0,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería validar formato UUID de appointmentId
    it('should validate appointmentId UUID format', async () => {
      const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 50.0,
          appointmentId: 'invalid-uuid',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // POST /api/v1/payments/checkout - Abrir checkout contra la pasarela de pago
  // (F3 del plan de pasarela). NOTA sobre el entorno de este test: el .env de
  // test no define PAYMENT_GATEWAY_PROVIDER, así que el default de env.ts
  // ('none') aplica y el contenedor cablea NoopPaymentGateway
  //  -- createCheckout() de la pasarela siempre lanza
  // BusinessRuleError('Payment gateway is not configured') (422). Eso es
  // justamente lo que permite probar acá toda la tubería (ownership,
  // estado de cita, idempotencia, 409, wiring) de punta a punta salvo la
  // llamada HTTP real a Mercado Pago: la Fase 7 (sandbox real, obligatoria
  // según D3) es la que prueba el 201 real contra el proveedor.
  describe('POST /api/v1/payments/checkout - Create Checkout', () => {
    // Debería rechazar sin autenticación
    it('should reject creation without authentication', async () => {
      const appointment = await createConfirmedTestAppointment();

      const response = await request(app).post('/api/v1/payments/checkout').send({
        amount: 50.0,
        appointmentId: appointment.id,
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    // Debería validar appointmentId requerido
    it('should validate appointmentId is required', async () => {
      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50.0 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería validar monto mayor a 0
    it('should validate amount is greater than 0', async () => {
      const appointment = await createConfirmedTestAppointment();

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0, appointmentId: appointment.id });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar una Idempotency-Key que no sea un UUID válido
    it('should validate the Idempotency-Key header when present', async () => {
      const appointment = await createConfirmedTestAppointment();

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'not-a-uuid')
        .send({ amount: 50.0, appointmentId: appointment.id });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería devolver 404 si la cita no existe
    it('should return 404 when appointment does not exist', async () => {
      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50.0, appointmentId: generateUuid() });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    // Debería devolver 422 si la cita no está CONFIRMED/COMPLETED
    it('should return 422 when appointment is not CONFIRMED or COMPLETED', async () => {
      const pendingStatus = await testPrisma.appointmentStatus.findFirst({
        where: { name: 'PENDING' },
      });
      const appointment = await createConfirmedTestAppointment({
        statusId: pendingStatus!.id,
        confirmedAt: null,
      });

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50.0, appointmentId: appointment.id });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar a un STYLIST que no es el dueño de la cita
    it('should reject a STYLIST who does not own the appointment', async () => {
      const appointment = await createConfirmedTestAppointment();

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({ amount: 50.0, appointmentId: appointment.id });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar a un CLIENT que no es el dueño de la cita
    it('should reject a CLIENT who does not own the appointment', async () => {
      const appointment = await createConfirmedTestAppointment();

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 50.0, appointmentId: appointment.id });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // D1: CLIENT SÍ puede abrir un checkout de su propia cita -- amplía F18
    // solo para esta ruta. Se llega hasta la pasarela (422 "not configured"
    // en este entorno de test), lo que prueba que el ownership check pasó.
    it('should let a CLIENT past ownership on their own appointment (D1)', async () => {
      const appointment = await createConfirmedTestAppointment({ clientId: clientUserId });

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 50.0, appointmentId: appointment.id });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('BUSINESS_RULE_ERROR');
    });

    // Camino feliz salvo la pasarela: ADMIN, ownership y estado de cita
    // pasan, se crea el Payment PENDING y termina FAILED cuando la pasarela
    // (Noop en este entorno) rechaza la creación -- confirma el wiring
    // completo de PaymentContainer y el guardado del failureReason.
    it('should create a PENDING payment and mark it FAILED when the gateway is not configured', async () => {
      const appointment = await createConfirmedTestAppointment();

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 123.45, appointmentId: appointment.id });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('BUSINESS_RULE_ERROR');

      const payments = await testPrisma.payment.findMany({
        where: { appointmentId: appointment.id },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe('FAILED');
      expect(payments[0].provider).toBe('MERCADO_PAGO');
      expect(payments[0].failureReason).toBe('Payment gateway is not configured');
    });

    // D5: un solo checkout PENDING por cita -- 409 si ya hay uno abierto
    // (gateway-backed) para la misma cita. Se inserta el Payment PENDING
    // directo por Prisma porque, en este entorno sin pasarela configurada,
    // no hay forma de dejar uno abierto pasando por el endpoint (siempre
    // termina en FAILED, ver el test de arriba).
    it('should return 409 when a PENDING gateway-backed checkout already exists for the appointment', async () => {
      const appointment = await createConfirmedTestAppointment();

      await testPrisma.payment.create({
        data: {
          id: generateUuid(),
          amount: 100,
          status: 'PENDING',
          appointmentId: appointment.id,
          provider: 'MERCADO_PAGO',
          idempotencyKey: generateUuid(),
        },
      });

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50.0, appointmentId: appointment.id });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
    });

    // Un pago MANUAL PENDING sobre la misma cita no debería disparar el 409:
    // la restricción es solo sobre checkouts de pasarela abiertos.
    it('should not conflict with a MANUAL PENDING payment on the same appointment', async () => {
      const appointment = await createConfirmedTestAppointment();

      await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, appointmentId: appointment.id });

      const response = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50.0, appointmentId: appointment.id });

      // Pasa el 409 y llega a la pasarela (Noop -> 422), en vez de 409
      expect(response.status).toBe(422);
    });
  });

  // GET /api/v1/payments - Obtener todos los pagos (Solo Admin)
  describe('GET /api/v1/payments - Get All Payments (Admin Only)', () => {
    // Debería obtener lista paginada de pagos como admin
    it('should get paginated list of payments as admin', async () => {
      const response = await request(app)
        .get('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('payments');
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('page');
      expect(response.body.data).toHaveProperty('limit');
      expect(response.body.data).toHaveProperty('totalPages');
      expect(response.body.data).toHaveProperty('hasNextPage');
      expect(response.body.data).toHaveProperty('hasPreviousPage');
      expect(Array.isArray(response.body.data.payments)).toBe(true);
    });

    // Debería rechazar acceso como cliente
    it('should reject access as client', async () => {
      const response = await request(app)
        .get('/api/v1/payments')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar acceso como estilista
    it('should reject access as stylist', async () => {
      const response = await request(app)
        .get('/api/v1/payments')
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería aceptar parámetros de paginación
    it('should accept pagination parameters', async () => {
      const response = await request(app)
        .get('/api/v1/payments?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.page).toBe(1);
      expect(response.body.data.limit).toBe(5);
    });

    // Debería filtrar por estado
    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/payments?status=PENDING')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      if (response.body.data.payments.length > 0) {
        response.body.data.payments.forEach((payment: any) => {
          expect(payment.status).toBe('PENDING');
        });
      }
    });

    // Debería filtrar por appointmentId
    it('should filter by appointmentId', async () => {
      const response = await request(app)
        .get(`/api/v1/payments?appointmentId=${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    // Debería validar estado inválido
    it('should validate invalid status', async () => {
      const response = await request(app)
        .get('/api/v1/payments?status=INVALID_STATUS')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // GET /api/v1/payments/statistics - Obtener estadísticas de pagos (Solo Admin)
  describe('GET /api/v1/payments/statistics - Get Payment Statistics (Admin Only)', () => {
    // Debería obtener estadísticas de pagos como admin
    it('should get payment statistics as admin', async () => {
      const response = await request(app)
        .get('/api/v1/payments/statistics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalRevenue');
      expect(response.body.data).toHaveProperty('totalPayments');
      expect(response.body.data).toHaveProperty('completedPayments');
      expect(response.body.data).toHaveProperty('pendingPayments');
      expect(response.body.data).toHaveProperty('refundedPayments');
      expect(response.body.data).toHaveProperty('failedPayments');
      expect(response.body.data).toHaveProperty('averagePayment');
      expect(response.body.data).toHaveProperty('paymentsByMethod');
    });

    // Debería rechazar acceso como cliente
    it('should reject access as client', async () => {
      const response = await request(app)
        .get('/api/v1/payments/statistics')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería aceptar filtros de fecha
    it('should accept date filters', async () => {
      const startDate = '2025-01-01';
      const endDate = '2025-12-31';

      const response = await request(app)
        .get(`/api/v1/payments/statistics?startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // GET /api/v1/payments/appointment/:appointmentId - Obtener pagos por cita
  describe('GET /api/v1/payments/appointment/:appointmentId - Get Payments by Appointment', () => {
    // Debería obtener pagos de una cita
    it('should get payments by appointment', async () => {
      const response = await request(app)
        .get(`/api/v1/payments/appointment/${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    // Debería rechazar sin autenticación
    it('should reject without authentication', async () => {
      const response = await request(app).get(`/api/v1/payments/appointment/${testAppointmentId}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    // Debería validar formato UUID de appointmentId
    it('should validate appointmentId UUID format', async () => {
      const response = await request(app)
        .get('/api/v1/payments/appointment/invalid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // GET /api/v1/payments/:id - Obtener pago por ID
  describe('GET /api/v1/payments/:id - Get Payment by ID', () => {
    // Debería obtener un pago por ID
    it('should get payment by ID', async () => {
      const response = await request(app)
        .get(`/api/v1/payments/${testPaymentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testPaymentId);
      expect(response.body.data).toHaveProperty('amount');
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('appointmentId');
    });

    // Debería retornar 404 para pago inexistente
    it('should return 404 for non-existent payment', async () => {
      const fakeId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const response = await request(app)
        .get(`/api/v1/payments/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    // Debería validar formato UUID
    it('should validate UUID format', async () => {
      const response = await request(app)
        .get('/api/v1/payments/invalid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar sin autenticación
    it('should reject without authentication', async () => {
      const response = await request(app).get(`/api/v1/payments/${testPaymentId}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    // CLIENT recibe 403 en GET /payments/:id (bloqueado a nivel de ruta;
    // hallazgo #2 Opción A: el CLIENT accede a sus pagos vía /appointment/:id)
    it('should reject access as client', async () => {
      const response = await request(app)
        .get(`/api/v1/payments/${testPaymentId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  // POST /api/v1/payments/:id/process - Procesar pago (Admin, Stylist)
  describe('POST /api/v1/payments/:id/process - Process Payment', () => {
    let pendingPaymentId: string;

    beforeAll(async () => {
      // Crear un pago pendiente para procesar
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100.0,
          appointmentId: testAppointmentId,
        });
      pendingPaymentId = createResponse.body.data.id;
    });

    // Debería procesar un pago como admin
    it('should process a payment as admin', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          method: 'CREDIT_CARD',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('COMPLETED');
      expect(response.body.data.method).toBe('CREDIT_CARD');
      expect(response.body.data.paymentDate).toBeDefined();
    });

    // Debería procesar un pago como estilista
    it('should process a payment as stylist', async () => {
      // Crear otro pago pendiente
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 80.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          method: 'CASH',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('COMPLETED');
      expect(response.body.data.method).toBe('CASH');
    });

    // Debería rechazar procesar como cliente
    it('should reject process as client', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 60.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          method: 'CASH',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería validar método de pago requerido
    it('should validate payment method is required', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 50.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería validar método de pago válido
    it('should validate valid payment method', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 50.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          method: 'INVALID_METHOD',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería aceptar todos los métodos de pago válidos
    it('should accept all valid payment methods', async () => {
      const methods = ['CASH', 'DEBIT_CARD', 'TRANSFER', 'ONLINE'];

      for (const method of methods) {
        const createResponse = await request(app)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            amount: 25.0,
            appointmentId: testAppointmentId,
          });

        const response = await request(app)
          .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ method });

        expect(response.status).toBe(200);
        expect(response.body.data.method).toBe(method);
      }
    });
  });

  // POST /api/v1/payments/:id/refund - Reembolsar pago (Solo Admin)
  describe('POST /api/v1/payments/:id/refund - Refund Payment (Admin Only)', () => {
    let completedPaymentId: string;

    beforeAll(async () => {
      // Crear y procesar un pago para reembolsar
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 120.0,
          appointmentId: testAppointmentId,
        });

      await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'CREDIT_CARD' });

      completedPaymentId = createResponse.body.data.id;
    });

    // Debería reembolsar un pago como admin
    it('should refund a payment as admin', async () => {
      const response = await request(app)
        .post(`/api/v1/payments/${completedPaymentId}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Cliente solicitó cancelación',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('REFUNDED');
    });

    // Debería reembolsar sin razón (razón opcional)
    it('should refund without reason (reason is optional)', async () => {
      // Crear y procesar otro pago
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 90.0,
          appointmentId: testAppointmentId,
        });

      await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'CASH' });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('REFUNDED');
    });

    // Debería rechazar reembolso como estilista
    it('should reject refund as stylist', async () => {
      // Crear y procesar un pago
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 70.0,
          appointmentId: testAppointmentId,
        });

      await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'CASH' });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/refund`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar reembolso de pago pendiente (error de regla de negocio)
    it('should reject refund of pending payment', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 55.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // 422 Unprocessable Entity - Error de regla de negocio
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
    });
  });

  // POST /api/v1/payments/:id/cancel - Cancelar pago (Admin, Stylist)
  describe('POST /api/v1/payments/:id/cancel - Cancel Payment', () => {
    // Debería cancelar un pago pendiente como admin
    it('should cancel a pending payment as admin', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 65.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('FAILED');
    });

    // Debería cancelar un pago pendiente como estilista
    it('should cancel a pending payment as stylist', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 45.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('FAILED');
    });

    // Debería rechazar cancelar como cliente
    it('should reject cancel as client', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 35.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar cancelar pago completado (error de regla de negocio)
    it('should reject cancel of completed payment', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 85.0,
          appointmentId: testAppointmentId,
        });

      await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'CASH' });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      // 422 Unprocessable Entity - Error de regla de negocio
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
    });
  });

  // PUT /api/v1/payments/:id - Actualizar pago (Solo Admin)
  describe('PUT /api/v1/payments/:id - Update Payment (Admin Only)', () => {
    // Debería actualizar el monto de un pago pendiente como admin
    it('should update amount of a pending payment as admin', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .put(`/api/v1/payments/${createResponse.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 150.0,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.amount).toBe(150.0);
    });

    // Debería rechazar actualización como estilista
    it('should reject update as stylist', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .put(`/api/v1/payments/${createResponse.body.data.id}`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          amount: 150.0,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar actualización de pago completado (error de regla de negocio)
    it('should reject update of completed payment', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100.0,
          appointmentId: testAppointmentId,
        });

      await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'CASH' });

      const response = await request(app)
        .put(`/api/v1/payments/${createResponse.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 200.0,
        });

      // 422 Unprocessable Entity - Error de regla de negocio
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
    });

    // Debería validar monto mayor a 0
    it('should validate amount is greater than 0', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100.0,
          appointmentId: testAppointmentId,
        });

      const response = await request(app)
        .put(`/api/v1/payments/${createResponse.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 0,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería validar formato UUID
    it('should validate UUID format', async () => {
      const response = await request(app)
        .put('/api/v1/payments/invalid-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100.0,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // Ownership en payments: STYLIST solo accede a pagos de sus propias
  // citas; CLIENT dueño de la cita gana acceso de lectura vía
  // GET /payments/appointment/:appointmentId; ADMIN sin restricción
  describe('Ownership (F18)', () => {
    let stylistAToken: string;
    let stylistAId: string;
    let stylistBToken: string;
    let clientToken: string;
    let clientId: string;
    let ownAppointmentId: string;

    beforeAll(async () => {
      // STYLIST A: dueño real de la cita bajo prueba
      const stylistA = await createTestStylist();
      stylistAId = stylistA.userId;
      const stylistALogin = await request(app).post('/api/v1/auth/login').send({
        email: stylistA.user.email,
        password: 'TestPass123!',
      });
      stylistAToken = stylistALogin.body.data.token;

      // STYLIST B: ajeno a la cita, debe ser rechazado
      const stylistB = await createTestStylist();
      const stylistBLogin = await request(app).post('/api/v1/auth/login').send({
        email: stylistB.user.email,
        password: 'TestPass123!',
      });
      stylistBToken = stylistBLogin.body.data.token;

      // CLIENT dueño de la cita
      const clientUser = await createTestUser('CLIENT');
      clientId = clientUser.user?.id || clientUser.id;
      const clientLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: clientUser.user?.email || clientUser.email,
          password: 'TestPass123!',
        });
      clientToken = clientLogin.body.data.token;

      // Cita confirmada asignada a STYLIST A y al CLIENT de arriba
      const appointment = await createConfirmedTestAppointment({
        stylistId: stylistAId,
        clientId,
        userId: clientId,
      });
      ownAppointmentId = appointment.id;
    });

    // STYLIST ajeno a la cita no debe poder procesar el pago (403 vía ownership check)
    it('should reject process by a stylist who does not own the appointment', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40.0, appointmentId: ownAppointmentId });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${stylistBToken}`)
        .send({ method: 'CASH' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // STYLIST ajeno a la cita no debe poder cancelar el pago (403 vía ownership check)
    it('should reject cancel by a stylist who does not own the appointment', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40.0, appointmentId: ownAppointmentId });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${stylistBToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // STYLIST ajeno a la cita no puede reembolsar (la ruta ya es ADMIN-only a
    // nivel de middleware, pero se documenta el comportamiento esperado)
    it('should reject refund by a stylist who does not own the appointment', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40.0, appointmentId: ownAppointmentId });

      await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'CASH' });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/refund`)
        .set('Authorization', `Bearer ${stylistBToken}`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // El STYLIST dueño real de la cita sí puede procesar su propio pago
    it('should allow the owning stylist to process a payment for their own appointment', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40.0, appointmentId: ownAppointmentId });

      const response = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${stylistAToken}`)
        .send({ method: 'CASH' });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('COMPLETED');
    });

    // El CLIENT dueño de la cita gana acceso de lectura a sus pagos (F18, alcance b)
    it('should allow the owning client to view payments via GET /payments/appointment/:appointmentId', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40.0, appointmentId: ownAppointmentId });

      const response = await request(app)
        .get(`/api/v1/payments/appointment/${ownAppointmentId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.some((p: any) => p.id === createResponse.body.data.id)).toBe(true);
    });

    // Un CLIENT ajeno a la cita no debe poder ver sus pagos
    it('should reject an unrelated client from viewing another appointment payments', async () => {
      const otherClientUser = await createTestUser('CLIENT');
      const otherClientLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: otherClientUser.user?.email || otherClientUser.email,
          password: 'TestPass123!',
        });
      const otherClientToken = otherClientLogin.body.data.token;

      const response = await request(app)
        .get(`/api/v1/payments/appointment/${ownAppointmentId}`)
        .set('Authorization', `Bearer ${otherClientToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    // ADMIN mantiene acceso sin restricción, sin importar la cita
    it('should allow ADMIN unrestricted access regardless of ownership', async () => {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40.0, appointmentId: ownAppointmentId });

      const getResponse = await request(app)
        .get(`/api/v1/payments/${createResponse.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.status).toBe(200);

      const cancelResponse = await request(app)
        .post(`/api/v1/payments/${createResponse.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(cancelResponse.status).toBe(200);
    });
  });
});
