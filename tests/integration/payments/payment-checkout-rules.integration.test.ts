import request from 'supertest';
import app from '../../../src/app';
import { loginAsAdmin } from '../../setup/helpers';
import { createConfirmedTestAppointment } from '../../setup/appointments-helpers';
import { createPricedTestService, deletePricedTestServices } from '../../setup/payments-helpers';
import { testPrisma } from '../../setup/database';
import { generateUuid } from '../../../src/shared/utils/uuid';

/**
 * Reglas de cobro del checkout, por HTTP y contra la base
 * @description La suite corre sin pasarela configurada, así que cada checkout
 * que pasa todas las reglas termina con 422 y el pago queda FAILED. Eso alcanza
 * para verificar lo que importa acá: el monto que se guardó, los checkouts que
 * se bloquean y los vencidos que se liberan.
 */
describe('Payments Integration Tests - Reglas de cobro del checkout', () => {
  let adminToken: string;
  let haircutId: string;
  let coloringId: string;
  const createdAppointmentIds: string[] = [];

  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

  const createAppointment = async (overrides: Record<string, unknown> = {}) => {
    const appointment = await createConfirmedTestAppointment({
      serviceIds: [haircutId, coloringId],
      ...overrides,
    });
    createdAppointmentIds.push(appointment.id);
    return appointment;
  };

  const postCheckout = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/v1/payments/checkout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
    haircutId = await createPricedTestService(2500);
    coloringId = await createPricedTestService(6000);
  });

  afterAll(async () => {
    await testPrisma.payment.deleteMany({
      where: { appointmentId: { in: createdAppointmentIds } },
    });
    await testPrisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    await deletePricedTestServices([haircutId, coloringId]);
  });

  // Debería guardar el monto calculado a partir de los servicios e ignorar el del body
  it('should store the amount computed from the services and ignore the one in the body', async () => {
    const appointment = await createAppointment();

    const response = await postCheckout({ appointmentId: appointment.id, amount: 1 });

    expect(response.status).toBe(422);
    const payments = await testPrisma.payment.findMany({
      where: { appointmentId: appointment.id },
    });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(85);
  });

  // Debería cobrar el precio propio del estilista de la cita
  it('should charge the custom price of the appointment stylist', async () => {
    const appointment = await createAppointment();
    await testPrisma.stylistService.create({
      data: { stylistId: appointment.stylistId!, serviceId: coloringId, customPrice: 7000 },
    });

    try {
      await postCheckout({ appointmentId: appointment.id });

      const payments = await testPrisma.payment.findMany({
        where: { appointmentId: appointment.id },
      });
      expect(Number(payments[0].amount)).toBe(95);
    } finally {
      await testPrisma.stylistService.deleteMany({
        where: { stylistId: appointment.stylistId!, serviceId: coloringId },
      });
    }
  });

  // Debería responder 422 sin crear el pago si la cita no tiene servicios
  it('should return 422 without creating a payment when the appointment has no services', async () => {
    const appointment = await createAppointment({ serviceIds: [] });

    const response = await postCheckout({ appointmentId: appointment.id });

    expect(response.status).toBe(422);
    expect(response.body.message).toBe(
      'Cannot create a checkout for an appointment without services to charge',
    );
    const count = await testPrisma.payment.count({ where: { appointmentId: appointment.id } });
    expect(count).toBe(0);
  });

  // Debería responder 409 si la cita ya tiene un pago manual completado
  it('should return 409 when the appointment already has a completed manual payment', async () => {
    const appointment = await createAppointment();
    await testPrisma.payment.create({
      data: {
        id: generateUuid(),
        amount: 85,
        status: 'COMPLETED',
        method: 'CASH',
        paymentDate: new Date(),
        appointmentId: appointment.id,
      },
    });

    const response = await postCheckout({ appointmentId: appointment.id });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'This appointment already has a completed payment. A new checkout cannot be opened.',
    );
    const count = await testPrisma.payment.count({ where: { appointmentId: appointment.id } });
    expect(count).toBe(1);
  });

  // Debería liberar un checkout vencido que no tiene pago en la pasarela
  it('should release an expired checkout that has no payment at the gateway', async () => {
    const appointment = await createAppointment();
    const expiredPaymentId = generateUuid();
    await testPrisma.payment.create({
      data: {
        id: expiredPaymentId,
        amount: 85,
        status: 'PENDING',
        appointmentId: appointment.id,
        provider: 'MERCADO_PAGO',
        idempotencyKey: generateUuid(),
        checkoutUrl: 'https://checkout.example/expired',
        gatewayPreferenceId: 'expired-preference-id',
        checkoutExpiresAt: minutesAgo(60),
        createdAt: minutesAgo(90),
      },
    });

    const response = await postCheckout({ appointmentId: appointment.id });

    // Pasa las reglas de cobro y llega a la pasarela (Noop -> 422), en vez de 409
    expect(response.status).toBe(422);
    const expiredPayment = await testPrisma.payment.findUnique({ where: { id: expiredPaymentId } });
    expect(expiredPayment!.status).toBe('FAILED');
    expect(expiredPayment!.failureReason).toBe(
      'Checkout expired without a payment at the payment gateway',
    );
    const count = await testPrisma.payment.count({ where: { appointmentId: appointment.id } });
    expect(count).toBe(2);
  });

  // Debería seguir respondiendo 409 mientras el checkout no venció
  it('should keep returning 409 while the checkout has not expired', async () => {
    const appointment = await createAppointment();
    await testPrisma.payment.create({
      data: {
        id: generateUuid(),
        amount: 85,
        status: 'PENDING',
        appointmentId: appointment.id,
        provider: 'MERCADO_PAGO',
        idempotencyKey: generateUuid(),
        checkoutExpiresAt: new Date(Date.now() + 20 * 60_000),
      },
    });

    const response = await postCheckout({ appointmentId: appointment.id });

    expect(response.status).toBe(409);
  });
});
