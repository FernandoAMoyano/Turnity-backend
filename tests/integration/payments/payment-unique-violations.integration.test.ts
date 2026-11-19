import { Prisma } from '@prisma/client';
import { createConfirmedTestAppointment } from '../../setup/appointments-helpers';
import { testPrisma } from '../../setup/database';
import { generateUuid } from '../../../src/shared/utils/uuid';

/**
 * Forma en que Prisma informa las violaciones de las restricciones únicas de Payment
 * @description El repositorio de pagos traduce estas violaciones a errores de
 * dominio leyendo `meta.target`. Los tests insertan directo con Prisma, sin
 * pasar por el repositorio, y fijan la forma exacta: si una actualización de
 * Prisma la cambia, fallan acá antes de que la traducción deje de funcionar en
 * silencio.
 */
describe('Payments Integration Tests - Unique constraint violations reported by Prisma', () => {
  const createdAppointmentIds: string[] = [];

  const createAppointmentId = async (): Promise<string> => {
    const appointment = await createConfirmedTestAppointment();
    createdAppointmentIds.push(appointment.id);
    return appointment.id;
  };

  const insertPayment = (
    appointmentId: string,
    data: { provider: 'MANUAL' | 'MERCADO_PAGO'; idempotencyKey?: string },
  ) =>
    testPrisma.payment.create({
      data: {
        id: generateUuid(),
        amount: 85,
        status: 'PENDING',
        appointmentId,
        provider: data.provider,
        idempotencyKey: data.idempotencyKey ?? generateUuid(),
      },
    });

  /**
   * Devuelve el error con el que falla la inserción, o falla el test si no falla
   */
  const captureError = async (insertion: Promise<unknown>): Promise<unknown> => {
    try {
      await insertion;
    } catch (error) {
      return error;
    }
    throw new Error('Expected the insertion to fail with a unique constraint violation');
  };

  afterAll(async () => {
    await testPrisma.payment.deleteMany({
      where: { appointmentId: { in: createdAppointmentIds } },
    });
    await testPrisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
  });

  // Debería informar la violación del índice de checkout abierto con la columna appointmentId
  it('should report the open gateway checkout index violation with appointmentId as target', async () => {
    const appointmentId = await createAppointmentId();
    await insertPayment(appointmentId, { provider: 'MERCADO_PAGO' });

    const error = await captureError(insertPayment(appointmentId, { provider: 'MERCADO_PAGO' }));

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).toMatchObject({ code: 'P2002', meta: { target: ['appointmentId'] } });
  });

  // Debería informar la violación de idempotencyKey con la columna idempotencyKey
  it('should report an idempotencyKey violation with idempotencyKey as target', async () => {
    const sharedKey = generateUuid();
    await insertPayment(await createAppointmentId(), {
      provider: 'MANUAL',
      idempotencyKey: sharedKey,
    });

    const error = await captureError(
      insertPayment(await createAppointmentId(), { provider: 'MANUAL', idempotencyKey: sharedKey }),
    );

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).toMatchObject({ code: 'P2002', meta: { target: ['idempotencyKey'] } });
  });

  // Debería informar idempotencyKey cuando un mismo checkout viola las dos restricciones
  it('should report the idempotencyKey violation when both constraints are violated at once', async () => {
    const appointmentId = await createAppointmentId();
    const sharedKey = generateUuid();
    await insertPayment(appointmentId, { provider: 'MERCADO_PAGO', idempotencyKey: sharedKey });

    const error = await captureError(
      insertPayment(appointmentId, { provider: 'MERCADO_PAGO', idempotencyKey: sharedKey }),
    );

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).toMatchObject({ code: 'P2002', meta: { target: ['idempotencyKey'] } });
  });
});
