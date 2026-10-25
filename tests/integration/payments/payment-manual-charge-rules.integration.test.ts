import request from 'supertest';
import app from '../../../src/app';
import { loginAsAdmin } from '../../setup/helpers';
import { createConfirmedTestAppointment } from '../../setup/appointments-helpers';
import { testPrisma } from '../../setup/database';
import { generateUuid } from '../../../src/shared/utils/uuid';
import { PrismaPaymentRepository } from '../../../src/modules/payments/infrastructure/persistence/PrismaPaymentRepository';
import {
  Payment,
  PaymentProviderEnum,
} from '../../../src/modules/payments/domain/entities/Payment';
import { ConflictError } from '../../../src/shared/exceptions/ConflictError';

/**
 * Cobro único de una cita en el camino manual, por HTTP y contra la base
 * @description La suite corre sin pasarela configurada: un checkout vencido
 * se revisa contra una pasarela que no reconoce ningún pago, así que se cierra
 * como FAILED y deja de bloquear.
 */
describe('Payments Integration Tests - Cobro único en el camino manual', () => {
  let adminToken: string;
  const createdAppointmentIds: string[] = [];

  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);
  const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

  const createAppointment = async () => {
    const appointment = await createConfirmedTestAppointment();
    createdAppointmentIds.push(appointment.id);
    return appointment;
  };

  const postPayment = (appointmentId: string, amount = 85) =>
    request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, appointmentId });

  const processPayment = (paymentId: string) =>
    request(app)
      .post(`/api/v1/payments/${paymentId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ method: 'CASH' });

  /**
   * Inserta un pago de pasarela con el checkout abierto hasta `checkoutExpiresAt`
   */
  const insertGatewayPayment = (
    appointmentId: string,
    data: { status?: 'PENDING' | 'COMPLETED' | 'FAILED'; checkoutExpiresAt?: Date } = {},
  ) =>
    testPrisma.payment.create({
      data: {
        id: generateUuid(),
        amount: 85,
        status: data.status ?? 'PENDING',
        appointmentId,
        provider: 'MERCADO_PAGO',
        idempotencyKey: generateUuid(),
        gatewayPreferenceId: `preference-${generateUuid()}`,
        checkoutUrl: 'https://checkout.example/test',
        checkoutExpiresAt: data.checkoutExpiresAt ?? minutesFromNow(30),
      },
    });

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
  });

  afterAll(async () => {
    await testPrisma.payment.deleteMany({
      where: { appointmentId: { in: createdAppointmentIds } },
    });
    await testPrisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
  });

  describe('POST /api/v1/payments', () => {
    // Debería responder 409 si la cita ya tiene un pago manual completado
    it('should return 409 when the appointment already has a completed manual payment', async () => {
      const appointment = await createAppointment();
      const first = await postPayment(appointment.id);
      await processPayment(first.body.data.id);

      const response = await postPayment(appointment.id);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'This appointment already has a completed payment. A new payment cannot be registered.',
      );
      const count = await testPrisma.payment.count({ where: { appointmentId: appointment.id } });
      expect(count).toBe(1);
    });

    // Debería responder 409 si la cita tiene un checkout de pasarela vigente
    it('should return 409 when the appointment has an open gateway checkout', async () => {
      const appointment = await createAppointment();
      await insertGatewayPayment(appointment.id);

      const response = await postPayment(appointment.id);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'There is a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it, before registering a manual payment.',
      );
    });

    // Debería registrar el pago si el pago anterior fue reembolsado
    it('should register the payment when the previous payment was refunded', async () => {
      const appointment = await createAppointment();
      const first = await postPayment(appointment.id);
      await processPayment(first.body.data.id);
      await request(app)
        .post(`/api/v1/payments/${first.body.data.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Turno reprogramado' });

      const response = await postPayment(appointment.id);

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('PENDING');
    });

    // Debería cerrar como FAILED un checkout vencido que la pasarela no reconoce y registrar el pago
    it('should close an expired checkout the gateway does not recognize as FAILED and register the payment', async () => {
      const appointment = await createAppointment();
      const expired = await insertGatewayPayment(appointment.id, {
        checkoutExpiresAt: minutesAgo(60),
      });

      const response = await postPayment(appointment.id);

      expect(response.status).toBe(201);
      const closed = await testPrisma.payment.findUnique({ where: { id: expired.id } });
      expect(closed?.status).toBe('FAILED');
    });
  });

  describe('POST /api/v1/payments/:id/process', () => {
    // Debería completar el pago si es el único de la cita
    it('should complete the payment when it is the only one of the appointment', async () => {
      const appointment = await createAppointment();
      const created = await postPayment(appointment.id);

      const response = await processPayment(created.body.data.id);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('COMPLETED');
    });

    // Debería responder 409 si el cliente pagó online entre la creación y el procesamiento
    it('should return 409 when the client paid online after the payment was created', async () => {
      const appointment = await createAppointment();
      const created = await postPayment(appointment.id);
      await insertGatewayPayment(appointment.id, { status: 'COMPLETED' });

      const response = await processPayment(created.body.data.id);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'This appointment already has a completed payment. This payment cannot be processed.',
      );
      const stillPending = await testPrisma.payment.findUnique({
        where: { id: created.body.data.id },
      });
      expect(stillPending?.status).toBe('PENDING');
    });

    // Debería responder 409 si se abrió un checkout de pasarela después de crear el pago
    it('should return 409 when a gateway checkout was opened after the payment was created', async () => {
      const appointment = await createAppointment();
      const created = await postPayment(appointment.id);
      await insertGatewayPayment(appointment.id);

      const response = await processPayment(created.body.data.id);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'There is a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it, before processing a manual payment.',
      );
    });
  });

  describe('Índice de un checkout de pasarela abierto por cita', () => {
    let repository: PrismaPaymentRepository;

    const gatewayPayment = (appointmentId: string, idempotencyKey = generateUuid()): Payment =>
      Payment.createForGateway(
        generateUuid(),
        85,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );

    beforeAll(() => {
      repository = new PrismaPaymentRepository(testPrisma);
    });

    // Debería lanzar ConflictError al guardar un segundo checkout PENDING para la misma cita
    it('should throw ConflictError when saving a second PENDING checkout for the same appointment', async () => {
      const appointment = await createAppointment();
      await repository.save(gatewayPayment(appointment.id));

      const result = repository.save(gatewayPayment(appointment.id));

      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toThrow(
        'There is already a pending checkout for this appointment',
      );
    });

    // Debería guardar un pago manual PENDING junto a un checkout abierto
    it('should save a PENDING manual payment next to an open checkout', async () => {
      const appointment = await createAppointment();
      await repository.save(gatewayPayment(appointment.id));

      const manual = await repository.save(Payment.create(generateUuid(), 85, appointment.id));

      expect(manual.isPending).toBe(true);
    });

    // Debería guardar un checkout nuevo cuando el anterior ya no está PENDING
    it('should save a new checkout once the previous one is no longer PENDING', async () => {
      const appointment = await createAppointment();
      const previous = await repository.save(gatewayPayment(appointment.id));
      await testPrisma.payment.update({ where: { id: previous.id }, data: { status: 'FAILED' } });

      const next = await repository.save(gatewayPayment(appointment.id));

      expect(next.isPending).toBe(true);
    });

    // No debería traducir a conflicto de checkout la violación de otra restricción única
    it('should not translate a violation of another unique constraint into a checkout conflict', async () => {
      const first = await createAppointment();
      const second = await createAppointment();
      const sharedKey = generateUuid();
      await repository.save(gatewayPayment(first.id, sharedKey));

      const result = repository.save(gatewayPayment(second.id, sharedKey));

      await expect(result).rejects.toMatchObject({ code: 'P2002' });
      await expect(result).rejects.not.toBeInstanceOf(ConflictError);
    });
  });
});
