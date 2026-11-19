import request from 'supertest';
import app from '../../../src/app';
import { createTestUser, loginAsAdmin } from '../../setup/helpers';
import { createConfirmedTestAppointment } from '../../setup/appointments-helpers';
import { testPrisma } from '../../setup/database';
import { generateUuid } from '../../../src/shared/utils/uuid';

/**
 * Datos de pasarela en las lecturas de un pago, por HTTP y contra la base
 */
describe('Payments Integration Tests - Gateway fields in payment reads', () => {
  let adminToken: string;
  let clientToken: string;
  let clientId: string;
  const createdAppointmentIds: string[] = [];

  const createAppointment = async (overrides: Record<string, unknown> = {}) => {
    const appointment = await createConfirmedTestAppointment(overrides);
    createdAppointmentIds.push(appointment.id);
    return appointment;
  };

  /**
   * Inserta un checkout de pasarela abierto
   */
  const insertGatewayCheckout = (
    appointmentId: string,
    data: { checkoutExpiresAt?: Date | null; createdAt?: Date } = {},
  ) =>
    testPrisma.payment.create({
      data: {
        id: generateUuid(),
        amount: 85,
        status: 'PENDING',
        appointmentId,
        provider: 'MERCADO_PAGO',
        idempotencyKey: generateUuid(),
        gatewayPreferenceId: `preference-${generateUuid()}`,
        checkoutUrl: 'https://checkout.example/test',
        checkoutExpiresAt:
          data.checkoutExpiresAt === undefined
            ? new Date('2026-11-12T18:30:00.000Z')
            : data.checkoutExpiresAt,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
    });

  const getPayment = (paymentId: string) =>
    request(app).get(`/api/v1/payments/${paymentId}`).set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    adminToken = await loginAsAdmin();

    const clientUser = await createTestUser('CLIENT');
    clientId = clientUser.user?.id || clientUser.id;
    const clientLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: clientUser.user?.email || clientUser.email, password: 'TestPass123!' });
    clientToken = clientLogin.body.data.token;
  });

  afterAll(async () => {
    await testPrisma.payment.deleteMany({
      where: { appointmentId: { in: createdAppointmentIds } },
    });
    await testPrisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
  });

  // Debería devolver los datos de pasarela de un checkout en GET /payments/:id
  it('should return the gateway data of a checkout in GET /payments/:id', async () => {
    const appointment = await createAppointment();
    const payment = await insertGatewayCheckout(appointment.id);

    const response = await getPayment(payment.id);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: payment.id,
      provider: 'MERCADO_PAGO',
      checkoutUrl: 'https://checkout.example/test',
      checkoutExpiresAt: '2026-11-12T18:30:00.000Z',
    });
    expect(response.body.data).not.toHaveProperty('idempotencyKey');
  });

  // Debería devolver el vencimiento por defecto cuando la pasarela no informó uno
  it('should return the default expiration when the gateway did not report one', async () => {
    const appointment = await createAppointment();
    const createdAt = new Date('2026-11-12T15:00:00.000Z');
    const payment = await insertGatewayCheckout(appointment.id, {
      checkoutExpiresAt: null,
      createdAt,
    });

    const response = await getPayment(payment.id);

    expect(response.status).toBe(200);
    expect(response.body.data.checkoutExpiresAt).toBe('2026-11-12T15:30:00.000Z');
  });

  // Debería informar MANUAL y omitir los datos de checkout de un pago manual
  it('should report MANUAL and leave the checkout data out for a manual payment', async () => {
    const appointment = await createAppointment();
    const payment = await testPrisma.payment.create({
      data: { id: generateUuid(), amount: 40, status: 'PENDING', appointmentId: appointment.id },
    });

    const response = await getPayment(payment.id);

    expect(response.status).toBe(200);
    expect(response.body.data.provider).toBe('MANUAL');
    expect(response.body.data).not.toHaveProperty('checkoutUrl');
    expect(response.body.data).not.toHaveProperty('checkoutExpiresAt');
  });

  // Debería devolverle al CLIENT dueño de la cita la URL de su checkout abierto
  it('should return the open checkout URL to the client who owns the appointment', async () => {
    const appointment = await createAppointment({ clientId, userId: clientId });
    const payment = await insertGatewayCheckout(appointment.id);

    const response = await request(app)
      .get(`/api/v1/payments/appointment/${appointment.id}`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(response.status).toBe(200);
    const returned = response.body.data.find((p: { id: string }) => p.id === payment.id);
    expect(returned).toMatchObject({
      provider: 'MERCADO_PAGO',
      checkoutUrl: 'https://checkout.example/test',
      checkoutExpiresAt: '2026-11-12T18:30:00.000Z',
    });
    expect(returned).not.toHaveProperty('idempotencyKey');
  });
});
