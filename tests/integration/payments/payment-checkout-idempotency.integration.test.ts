import request from 'supertest';
import app from '../../../src/app';
import { loginAsAdmin } from '../../setup/helpers';
import { createConfirmedTestAppointment } from '../../setup/appointments-helpers';
import { createPricedTestService, deletePricedTestServices } from '../../setup/payments-helpers';
import { testPrisma } from '../../setup/database';
import { generateUuid } from '../../../src/shared/utils/uuid';
import { PaymentGatewayError } from '../../../src/modules/payments/domain/gateways/PaymentGatewayError';
import { FakePaymentGateway } from '../../unit/payments/fakes/FakePaymentGateway';

/**
 * Reemplaza la fábrica del gateway por un doble que crea el checkout sin salir
 * a la red. El vencimiento de la preferencia se fija en el futuro: uno vencido
 * haría que el cobro único revisara y cerrara cada checkout, y los tests
 * dejarían de probar la idempotencia. El doble se expone en el módulo simulado
 * para que cada test pueda hacer fallar la pasarela.
 */
jest.mock('../../../src/modules/payments/infrastructure/gateways/PaymentGatewayFactory', () => {
  const { FakePaymentGateway: Fake } = jest.requireActual(
    '../../unit/payments/fakes/FakePaymentGateway',
  );
  const fakeGateway = new Fake();
  fakeGateway.checkoutResult = {
    ...fakeGateway.checkoutResult,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  };

  return {
    createPaymentGateway: () => fakeGateway,
    fakeGateway,
  };
});

const { fakeGateway } = jest.requireMock(
  '../../../src/modules/payments/infrastructure/gateways/PaymentGatewayFactory',
) as { fakeGateway: FakePaymentGateway };

/**
 * Checkouts con una misma `Idempotency-Key`, por HTTP y contra la base
 */
describe('Payments Integration Tests - Checkout Idempotency-Key', () => {
  let adminToken: string;
  let haircutId: string;
  const createdAppointmentIds: string[] = [];

  const createAppointment = async () => {
    const appointment = await createConfirmedTestAppointment({ serviceIds: [haircutId] });
    createdAppointmentIds.push(appointment.id);
    return appointment;
  };

  const postCheckout = (appointmentId: string, idempotencyKey: string) =>
    request(app)
      .post('/api/v1/payments/checkout')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ appointmentId });

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
    haircutId = await createPricedTestService(2500);
  });

  afterEach(() => {
    fakeGateway.createCheckoutError = null;
  });

  afterAll(async () => {
    await testPrisma.payment.deleteMany({
      where: { appointmentId: { in: createdAppointmentIds } },
    });
    await testPrisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    await deletePricedTestServices([haircutId]);
  });

  // Debería terminar en un solo pago, sin errores internos, ante pedidos simultáneos con la misma clave
  it('should end with a single payment and no internal errors for simultaneous requests with the same key', async () => {
    const appointment = await createAppointment();
    const key = generateUuid();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postCheckout(appointment.id, key)),
    );

    const statuses = responses.map((response) => response.status);
    for (const status of statuses) {
      expect([200, 201, 409]).toContain(status);
    }
    expect(statuses).toContain(201);

    const paymentIds = new Set(
      responses
        .filter((response) => response.status === 200 || response.status === 201)
        .map((response) => response.body.data.paymentId),
    );
    expect(paymentIds.size).toBe(1);

    for (const response of responses.filter((r) => r.status === 409)) {
      expect(response.body.message).toBe(
        'A checkout with this Idempotency-Key is still being created. Retry the request in a few seconds.',
      );
    }

    const payments = await testPrisma.payment.findMany({
      where: { appointmentId: appointment.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].idempotencyKey).toBe(key);
  });

  // Debería devolver el mismo checkout con 200 al reintentar con la misma clave
  it('should return the same checkout with 200 when retrying with the same key', async () => {
    const appointment = await createAppointment();
    const key = generateUuid();

    const first = await postCheckout(appointment.id, key);
    const retry = await postCheckout(appointment.id, key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(first.body.data.paymentId);
  });

  // Debería rechazar con 422 una clave ya usada para otra cita
  it('should reject with 422 a key already used for another appointment', async () => {
    const first = await createAppointment();
    const second = await createAppointment();
    const key = generateUuid();
    await postCheckout(first.id, key);

    const response = await postCheckout(second.id, key);

    expect(response.status).toBe(422);
    expect(response.body.message).toBe(
      'This Idempotency-Key was already used for another appointment. Use a new key.',
    );
    const payments = await testPrisma.payment.findMany({ where: { appointmentId: second.id } });
    expect(payments).toHaveLength(0);
  });

  // Debería rechazar con 422 el reintento con la clave de un checkout que la pasarela no pudo crear
  it('should reject with 422 a retry with the key of a checkout the gateway failed to create', async () => {
    const appointment = await createAppointment();
    const key = generateUuid();
    fakeGateway.createCheckoutError = new PaymentGatewayError('Service unavailable', 503);

    const failed = await postCheckout(appointment.id, key);
    fakeGateway.createCheckoutError = null;
    const retry = await postCheckout(appointment.id, key);

    expect(failed.status).toBe(502);
    expect(retry.status).toBe(422);
    expect(retry.body.message).toBe(
      'This Idempotency-Key belongs to a checkout that could not be created. Use a new key to try again.',
    );
    const payments = await testPrisma.payment.findMany({
      where: { appointmentId: appointment.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('FAILED');
    expect(payments[0].checkoutUrl).toBeNull();
  });

  // Debería abrir un checkout nuevo con una clave nueva después de que la pasarela falló
  it('should open a new checkout with a new key after the gateway failed', async () => {
    const appointment = await createAppointment();
    fakeGateway.createCheckoutError = new PaymentGatewayError('Service unavailable', 503);
    await postCheckout(appointment.id, generateUuid());
    fakeGateway.createCheckoutError = null;

    const response = await postCheckout(appointment.id, generateUuid());

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('PENDING');
  });
});
