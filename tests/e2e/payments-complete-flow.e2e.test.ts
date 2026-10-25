import request from 'supertest';
import app from '../../src/app';
import { loginAsAdmin, loginTestUser } from '../setup/helpers';
import { createConfirmedTestAppointment } from '../setup/appointments-helpers';

// Tests E2E para el flujo completo del módulo de Pagos
describe('Payments Complete Flow E2E Tests', () => {
  let adminToken: string;
  let userToken: string;
  let stylistToken: string;
  let stylistId: string;
  let testAppointmentId: string;

  /**
   * Crea un pago manual PENDING sobre una cita confirmada nueva
   * @description Una cita se cobra una sola vez: si el pago se creara sobre una
   * cita compartida con un test que ya completó otro pago, respondería 409.
   * @param token - Token del usuario que crea el pago
   * @param amount - Monto del pago
   * @returns La respuesta de POST /api/v1/payments
   */
  const createPendingManualPayment = async (token: string, amount: number) => {
    const appointment = await createConfirmedTestAppointment({ stylistId });
    return request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount, appointmentId: appointment.id });
  };

  beforeAll(async () => {
    // Login como admin
    adminToken = await loginAsAdmin();

    // Crear y loguear usuario de prueba (cliente)
    const userData = await loginTestUser();
    userToken = userData.token;

    // Login como estilista
    const stylistResponse = await request(app).post('/api/v1/auth/login').send({
      email: 'lucia@turnity.com',
      password: 'stylist123',
    });
    stylistToken = stylistResponse.body.data.token;
    stylistId = stylistResponse.body.data.user.id;

    // Crear una cita de prueba confirmada para los tests E2E de pagos, asignada
    // explícitamente al estilista de arriba (F18: el flujo de permisos más abajo
    // depende de que sea dueño real de la cita, ver ownership check)
    const appointment = await createConfirmedTestAppointment({ stylistId });
    testAppointmentId = appointment.id;
  });

  /**
   * FLUJO COMPLETO: Ciclo de vida de un pago
   *
   * Este test simula el flujo completo desde la perspectiva del negocio:
   * 1. Admin/Stylist crea un pago pendiente asociado a una cita
   * 2. Se consulta el pago creado
   * 3. Se procesa el pago con un método de pago
   * 4. Se verifican las estadísticas
   * 5. Se reembolsa el pago (si es necesario)
   * 6. Se verifican las estadísticas actualizadas
   */
  // Flujo completo del ciclo de vida de un pago
  it('should complete full payment lifecycle flow', async () => {
    // ==========================================
    // FASE 1: CREACIÓN DEL PAGO
    // ==========================================

    // 1.1 Admin crea un pago pendiente
    const createPaymentResponse = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 150.0,
        appointmentId: testAppointmentId,
      });

    expect(createPaymentResponse.status).toBe(201);
    expect(createPaymentResponse.body.success).toBe(true);
    expect(createPaymentResponse.body.data.status).toBe('PENDING');
    expect(createPaymentResponse.body.data.amount).toBe(150.0);
    expect(createPaymentResponse.body.data.method).toBeNull();
    expect(createPaymentResponse.body.data.paymentDate).toBeNull();

    const paymentId = createPaymentResponse.body.data.id;

    // ==========================================
    // FASE 2: CONSULTA DEL PAGO
    // ==========================================

    // 2.1 Obtener el pago por ID
    const getPaymentResponse = await request(app)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getPaymentResponse.status).toBe(200);
    expect(getPaymentResponse.body.data.id).toBe(paymentId);
    expect(getPaymentResponse.body.data.status).toBe('PENDING');

    // 2.2 Obtener pagos por cita
    const paymentsByAppointmentResponse = await request(app)
      .get(`/api/v1/payments/appointment/${testAppointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(paymentsByAppointmentResponse.status).toBe(200);
    expect(Array.isArray(paymentsByAppointmentResponse.body.data)).toBe(true);
    const paymentInList = paymentsByAppointmentResponse.body.data.find(
      (p: any) => p.id === paymentId,
    );
    expect(paymentInList).toBeDefined();

    // 2.3 Verificar en lista general con filtro
    const paymentsListResponse = await request(app)
      .get('/api/v1/payments?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(paymentsListResponse.status).toBe(200);
    expect(paymentsListResponse.body.data.payments.length).toBeGreaterThanOrEqual(1);

    // ==========================================
    // FASE 3: PROCESAMIENTO DEL PAGO
    // ==========================================

    // 3.1 Procesar el pago con tarjeta de crédito
    const processPaymentResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        method: 'CREDIT_CARD',
      });

    expect(processPaymentResponse.status).toBe(200);
    expect(processPaymentResponse.body.success).toBe(true);
    expect(processPaymentResponse.body.data.status).toBe('COMPLETED');
    expect(processPaymentResponse.body.data.method).toBe('CREDIT_CARD');
    expect(processPaymentResponse.body.data.paymentDate).toBeDefined();

    // 3.2 Verificar que el pago ya no aparece como pendiente
    const pendingAfterProcessResponse = await request(app)
      .get('/api/v1/payments?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`);

    const stillPending = pendingAfterProcessResponse.body.data.payments.find(
      (p: any) => p.id === paymentId,
    );
    expect(stillPending).toBeUndefined();

    // 3.3 Verificar que aparece como completado
    const completedResponse = await request(app)
      .get('/api/v1/payments?status=COMPLETED')
      .set('Authorization', `Bearer ${adminToken}`);

    const completedPayment = completedResponse.body.data.payments.find(
      (p: any) => p.id === paymentId,
    );
    expect(completedPayment).toBeDefined();
    expect(completedPayment.status).toBe('COMPLETED');

    // ==========================================
    // FASE 4: ESTADÍSTICAS
    // ==========================================

    // 4.1 Obtener estadísticas generales
    const statisticsResponse = await request(app)
      .get('/api/v1/payments/statistics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statisticsResponse.status).toBe(200);
    expect(statisticsResponse.body.data).toHaveProperty('totalRevenue');
    expect(statisticsResponse.body.data).toHaveProperty('totalPayments');
    expect(statisticsResponse.body.data).toHaveProperty('completedPayments');
    expect(statisticsResponse.body.data).toHaveProperty('pendingPayments');
    expect(statisticsResponse.body.data).toHaveProperty('refundedPayments');
    expect(statisticsResponse.body.data).toHaveProperty('failedPayments');
    expect(statisticsResponse.body.data).toHaveProperty('averagePayment');
    expect(statisticsResponse.body.data).toHaveProperty('paymentsByMethod');
    expect(statisticsResponse.body.data.completedPayments).toBeGreaterThanOrEqual(1);

    // ==========================================
    // FASE 5: REEMBOLSO
    // ==========================================

    // 5.1 Reembolsar el pago
    const refundResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'Cliente solicitó cancelación del servicio',
      });

    expect(refundResponse.status).toBe(200);
    expect(refundResponse.body.success).toBe(true);
    expect(refundResponse.body.data.status).toBe('REFUNDED');

    // 5.2 Verificar que el pago aparece como reembolsado
    const refundedResponse = await request(app)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(refundedResponse.body.data.status).toBe('REFUNDED');

    // 5.3 Verificar estadísticas actualizadas
    const statsAfterRefundResponse = await request(app)
      .get('/api/v1/payments/statistics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statsAfterRefundResponse.body.data.refundedPayments).toBeGreaterThanOrEqual(1);
  });

  /**
   * FLUJO DE ACTUALIZACIÓN: Modificar monto antes de procesar
   *
   * Simula el escenario donde se crea un pago y se necesita ajustar
   * el monto antes de procesarlo.
   */
  // Flujo de actualización de monto antes de procesar
  it('should allow amount update before processing', async () => {
    // 1. Crear pago pendiente
    const createResponse = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 100.0,
        appointmentId: testAppointmentId,
      });

    expect(createResponse.status).toBe(201);
    const paymentId = createResponse.body.data.id;

    // 2. Actualizar el monto (agregar propina o ajuste)
    const updateResponse = await request(app)
      .put(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 120.0,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.amount).toBe(120.0);

    // 3. Verificar que el monto se actualizó
    const getResponse = await request(app)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getResponse.body.data.amount).toBe(120.0);

    // 4. Procesar con el nuevo monto
    const processResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        method: 'CASH',
      });

    expect(processResponse.status).toBe(200);
    expect(processResponse.body.data.amount).toBe(120.0);
    expect(processResponse.body.data.status).toBe('COMPLETED');

    // 5. Verificar que ya no se puede actualizar después de procesar
    const updateAfterProcessResponse = await request(app)
      .put(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 150.0,
      });

    // 422 Unprocessable Entity - Error de regla de negocio
    expect(updateAfterProcessResponse.status).toBe(422);
    expect(updateAfterProcessResponse.body.success).toBe(false);
  });

  /**
   * FLUJO DE CANCELACIÓN: Cancelar pago pendiente
   *
   * Simula el escenario donde se cancela un pago antes de procesarlo.
   */
  // Flujo de cancelación de pago pendiente
  it('should allow cancellation of pending payment', async () => {
    // 1. Crear pago pendiente
    const createResponse = await createPendingManualPayment(adminToken, 75.0);

    expect(createResponse.status).toBe(201);
    const paymentId = createResponse.body.data.id;

    // 2. Cancelar el pago
    const cancelResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.data.status).toBe('FAILED');

    // 3. Verificar que el pago está cancelado
    const getResponse = await request(app)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getResponse.body.data.status).toBe('FAILED');

    // 4. Verificar que no se puede procesar un pago cancelado
    const processAttemptResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        method: 'CASH',
      });

    // 422 Unprocessable Entity - Error de regla de negocio
    expect(processAttemptResponse.status).toBe(422);
    expect(processAttemptResponse.body.success).toBe(false);
  });

  /**
   * FLUJO DE MÉTODOS DE PAGO: Verificar todos los métodos disponibles
   *
   * Valida que el sistema acepta todos los métodos de pago definidos.
   */
  // Flujo de verificación de todos los métodos de pago
  it('should support all payment methods', async () => {
    const paymentMethods = ['CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'ONLINE'];

    for (const method of paymentMethods) {
      // Crear pago
      const createResponse = await createPendingManualPayment(adminToken, 50.0);

      expect(createResponse.status).toBe(201);
      const paymentId = createResponse.body.data.id;

      // Procesar con el método específico
      const processResponse = await request(app)
        .post(`/api/v1/payments/${paymentId}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method });

      expect(processResponse.status).toBe(200);
      expect(processResponse.body.data.method).toBe(method);
      expect(processResponse.body.data.status).toBe('COMPLETED');
    }

    // Verificar estadísticas por método
    const statsResponse = await request(app)
      .get('/api/v1/payments/statistics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.data.paymentsByMethod).toBeDefined();
  });

  /**
   * FLUJO DE PERMISOS: Verificar control de acceso por roles
   *
   * Valida que:
   * - Admin puede hacer todo
   * - Stylist puede crear, procesar y cancelar
   * - Stylist NO puede: listar todos, ver estadísticas, actualizar, reembolsar
   * - Client NO puede hacer nada relacionado con pagos
   */
  // Flujo de verificación de permisos por rol
  it('should enforce role-based access control', async () => {
    // ==========================================
    // STYLIST: Permisos permitidos
    // ==========================================

    // Stylist puede crear pago
    const stylistCreateResponse = await createPendingManualPayment(stylistToken, 60.0);

    expect(stylistCreateResponse.status).toBe(201);
    const stylistPaymentId = stylistCreateResponse.body.data.id;

    // Stylist puede procesar pago
    const stylistProcessResponse = await request(app)
      .post(`/api/v1/payments/${stylistPaymentId}/process`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({
        method: 'CASH',
      });

    expect(stylistProcessResponse.status).toBe(200);

    // ==========================================
    // STYLIST: Permisos denegados
    // ==========================================

    // Stylist NO puede listar todos los pagos
    const stylistListResponse = await request(app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${stylistToken}`);

    expect(stylistListResponse.status).toBe(403);

    // Stylist NO puede ver estadísticas
    const stylistStatsResponse = await request(app)
      .get('/api/v1/payments/statistics')
      .set('Authorization', `Bearer ${stylistToken}`);

    expect(stylistStatsResponse.status).toBe(403);

    // Stylist NO puede actualizar monto
    const anotherPaymentResponse = await createPendingManualPayment(adminToken, 80.0);

    const anotherPaymentId = anotherPaymentResponse.body.data.id;

    const stylistUpdateResponse = await request(app)
      .put(`/api/v1/payments/${anotherPaymentId}`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({
        amount: 100.0,
      });

    expect(stylistUpdateResponse.status).toBe(403);

    // Stylist NO puede reembolsar
    // Primero procesar el pago
    await request(app)
      .post(`/api/v1/payments/${anotherPaymentId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ method: 'CASH' });

    const stylistRefundResponse = await request(app)
      .post(`/api/v1/payments/${anotherPaymentId}/refund`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({});

    expect(stylistRefundResponse.status).toBe(403);

    // ==========================================
    // CLIENT: Todo denegado
    // ==========================================

    // Client NO puede crear pago
    const clientCreateResponse = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        amount: 50.0,
        appointmentId: testAppointmentId,
      });

    expect(clientCreateResponse.status).toBe(403);

    // Client NO puede listar pagos
    const clientListResponse = await request(app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${userToken}`);

    expect(clientListResponse.status).toBe(403);

    // Client NO puede ver estadísticas
    const clientStatsResponse = await request(app)
      .get('/api/v1/payments/statistics')
      .set('Authorization', `Bearer ${userToken}`);

    expect(clientStatsResponse.status).toBe(403);

    // ==========================================
    // SIN AUTENTICACIÓN: Todo denegado
    // ==========================================

    const noAuthCreateResponse = await request(app)
      .post('/api/v1/payments')
      .send({
        amount: 50.0,
        appointmentId: testAppointmentId,
      });

    expect(noAuthCreateResponse.status).toBe(401);

    const noAuthListResponse = await request(app).get('/api/v1/payments');

    expect(noAuthListResponse.status).toBe(401);
  });

  /**
   * FLUJO DE PAGINACIÓN Y FILTROS: Verificar consultas avanzadas
   *
   * Valida que la paginación y los filtros funcionan correctamente.
   */
  // Flujo de paginación y filtros
  it('should support pagination and filters correctly', async () => {
    // Crear varios pagos pendientes sobre una cita propia para tener datos
    const { id: appointmentId } = await createConfirmedTestAppointment({ stylistId });
    const paymentsToCreate = 5;
    for (let i = 0; i < paymentsToCreate; i++) {
      const createResponse = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 30.0 + i * 10,
          appointmentId,
        });
      expect(createResponse.status).toBe(201);
    }

    // Verificar paginación
    const page1Response = await request(app)
      .get('/api/v1/payments?page=1&limit=3')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(page1Response.status).toBe(200);
    expect(page1Response.body.data.page).toBe(1);
    expect(page1Response.body.data.limit).toBe(3);
    expect(page1Response.body.data.payments.length).toBeLessThanOrEqual(3);
    expect(page1Response.body.data).toHaveProperty('total');
    expect(page1Response.body.data).toHaveProperty('totalPages');
    expect(page1Response.body.data).toHaveProperty('hasNextPage');
    expect(page1Response.body.data).toHaveProperty('hasPreviousPage');

    // Verificar filtro por estado
    const pendingResponse = await request(app)
      .get('/api/v1/payments?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(pendingResponse.status).toBe(200);
    pendingResponse.body.data.payments.forEach((payment: any) => {
      expect(payment.status).toBe('PENDING');
    });

    // Verificar filtro por appointmentId
    const byAppointmentResponse = await request(app)
      .get(`/api/v1/payments?appointmentId=${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(byAppointmentResponse.status).toBe(200);
    byAppointmentResponse.body.data.payments.forEach((payment: any) => {
      expect(payment.appointmentId).toBe(appointmentId);
    });
  });

  /**
   * FLUJO DE ESTADÍSTICAS CON FILTROS DE FECHA
   *
   * Valida que las estadísticas se pueden filtrar por rango de fechas.
   */
  // Flujo de estadísticas con filtros de fecha
  it('should support statistics with date filters', async () => {
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
    const endOfYear = new Date(today.getFullYear(), 11, 31).toISOString().split('T')[0];

    // Estadísticas del año actual
    const yearStatsResponse = await request(app)
      .get(`/api/v1/payments/statistics?startDate=${startOfYear}&endDate=${endOfYear}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(yearStatsResponse.status).toBe(200);
    expect(yearStatsResponse.body.data).toHaveProperty('totalRevenue');
    expect(yearStatsResponse.body.data).toHaveProperty('totalPayments');

    // Estadísticas de un período sin datos (año pasado lejano)
    const emptyStatsResponse = await request(app)
      .get('/api/v1/payments/statistics?startDate=2020-01-01&endDate=2020-01-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(emptyStatsResponse.status).toBe(200);
    // Puede tener 0 pagos en ese período
    expect(emptyStatsResponse.body.data.totalPayments).toBeGreaterThanOrEqual(0);
  });

  /**
   * FLUJO DE REGLAS DE NEGOCIO: Validar restricciones
   *
   * Verifica que las reglas de negocio se aplican correctamente:
   * - No se puede reembolsar un pago pendiente
   * - No se puede cancelar un pago completado
   * - No se puede procesar un pago ya procesado
   */
  // Flujo de validación de reglas de negocio
  it('should enforce business rules correctly', async () => {
    // Crear pago
    const createResponse = await createPendingManualPayment(adminToken, 100.0);

    const paymentId = createResponse.body.data.id;

    // NO se puede reembolsar un pago pendiente
    const refundPendingResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(refundPendingResponse.status).toBe(422);

    // Procesar el pago
    await request(app)
      .post(`/api/v1/payments/${paymentId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ method: 'CASH' });

    // NO se puede cancelar un pago completado
    const cancelCompletedResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(cancelCompletedResponse.status).toBe(422);

    // NO se puede procesar un pago ya procesado
    const processAgainResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ method: 'CREDIT_CARD' });

    expect(processAgainResponse.status).toBe(422);

    // Reembolsar el pago
    await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    // NO se puede reembolsar un pago ya reembolsado
    const refundAgainResponse = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(refundAgainResponse.status).toBe(422);
  });
});
