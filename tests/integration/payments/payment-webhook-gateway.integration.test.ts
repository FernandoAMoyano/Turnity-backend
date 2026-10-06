import request from 'supertest';
import { createHmac } from 'crypto';
import app from '../../../src/app';
import { testPrisma } from '../../setup/database';
import { loginAsAdmin } from '../../setup/helpers';
import { createConfirmedTestAppointment } from '../../setup/appointments-helpers';
import { generateUuid } from '../../../src/shared/utils/uuid';

/**
 * Reemplaza la fábrica del gateway para que la aplicación use el adapter real
 * de Mercado Pago con un `fetch` inyectado. Así se ejercita todo el código
 * propio (firma, parseo, re-fetch, búsqueda por referencia externa y
 * persistencia) sin salir a la red. `jest.mock` se eleva por encima de los
 * imports, por eso la API simulada se invoca de forma diferida desde el
 * closure y no se lee al construir el adapter.
 */
jest.mock('../../../src/modules/payments/infrastructure/gateways/PaymentGatewayFactory', () => {
  const { MercadoPagoGateway } = jest.requireActual(
    '../../../src/modules/payments/infrastructure/gateways/MercadoPagoGateway',
  );

  return {
    createPaymentGateway: () =>
      new MercadoPagoGateway(
        {
          accessToken: 'APP_USR-integration-test-token',
          webhookSecret: 'integration-test-webhook-secret-not-real',
          currency: 'ARS',
          frontendUrl: 'https://turnity.test',
          timeoutMs: 5000,
          signatureToleranceSeconds: 300,
        },
        (input: string | URL | Request, init?: RequestInit) => mockMercadoPagoFetch(input, init),
      ),
  };
});

const WEBHOOK_PATH = '/api/v1/payments/webhooks/mercadopago';
const MERCADO_PAGO_API = 'https://api.mercadopago.com';
const ACCESS_TOKEN = 'APP_USR-integration-test-token';
const WEBHOOK_SECRET = 'integration-test-webhook-secret-not-real';

/** Una llamada saliente que el adapter hizo contra la API simulada */
interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * Estado de la API de Mercado Pago simulada. Cada test carga los pagos que
 * la API debe conocer; las llamadas registradas se vacían antes de cada test.
 * No se usa `jest.fn` porque la configuración de Jest resetea los mocks entre
 * tests.
 */
const mockMercadoPagoState = {
  paymentsById: new Map<string, Record<string, unknown>>(),
  searchResultsByReference: new Map<string, Array<Record<string, unknown>>>(),
  calls: [] as RecordedCall[],
};

/**
 * `fetch` que responde los dos endpoints de lectura que usa el adapter con la
 * misma forma que la API real: `GET /v1/payments/{id}` (404 si el pago no
 * existe) y `GET /v1/payments/search`. Cualquier otra llamada hace fallar el
 * test.
 */
async function mockMercadoPagoFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
  );
  const method = init?.method ?? 'GET';
  mockMercadoPagoState.calls.push({
    url: url.toString(),
    method,
    headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
  });

  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  if (method === 'GET' && url.pathname === '/v1/payments/search') {
    const reference = url.searchParams.get('external_reference') ?? '';
    const results = mockMercadoPagoState.searchResultsByReference.get(reference) ?? [];
    return json({ paging: { total: results.length, limit: 30, offset: 0 }, results }, 200);
  }

  const paymentMatch = /^\/v1\/payments\/([^/]+)$/.exec(url.pathname);
  if (method === 'GET' && paymentMatch) {
    const payment = mockMercadoPagoState.paymentsById.get(paymentMatch[1]);
    return payment
      ? json(payment, 200)
      : json({ message: 'Payment not found', error: 'not_found', status: 404 }, 404);
  }

  throw new Error(`Llamada inesperada a la API de Mercado Pago: ${method} ${url.toString()}`);
}

/**
 * Tests de integración del webhook y de la sincronización contra el adapter
 * real de Mercado Pago.
 *
 * Complementa a `payment-webhook.integration.test.ts`, que prueba la plomería
 * con `NoopPaymentGateway`. Acá la cadena completa corre por HTTP: la ruta, el
 * body crudo, la verificación de la firma con el manifest de Mercado Pago, el
 * parseo que conserva los identificadores enteros grandes, la consulta a la
 * API y la persistencia del pago y del evento. Las notificaciones replican la
 * forma de las que Mercado Pago envía en sandbox: `id` numérico de 17
 * dígitos, `data.id` como string, `ts` en segundos y `data.id` repetido en la
 * query string.
 */
describe('Payment gateway webhook and sync with the Mercado Pago adapter', () => {
  const createdPaymentIds: string[] = [];
  const createdEventIds: string[] = [];
  let appointmentId: string;
  let adminToken: string;

  /** Base de los identificadores de la corrida, para no chocar con corridas anteriores */
  const runSeed = Date.now();
  let sequence = 0;

  /**
   * Genera un `id` de notificación de 17 dígitos, mayor que
   * `Number.MAX_SAFE_INTEGER` y que no es múltiplo de 8: si algo lo pasara por
   * `JSON.parse` sin protección, el valor redondeado sería distinto y el test
   * lo detectaría.
   */
  const nextEventId = (): string => {
    let candidate = 10n ** 16n + BigInt(runSeed) * 1000n + BigInt(sequence);
    sequence += 1;
    if (candidate % 8n === 0n) {
      candidate += 1n;
      sequence += 1;
    }
    const eventId = candidate.toString();
    createdEventIds.push(eventId);
    return eventId;
  };

  /** Genera un id de pago de Mercado Pago de 12 dígitos, como los de sandbox */
  const nextGatewayPaymentId = (): string => {
    sequence += 1;
    return String(100_000_000_000 + ((runSeed * 10 + sequence) % 900_000_000_000));
  };

  /** Crea un pago de pasarela PENDING, como lo deja el checkout */
  const createPendingGatewayPayment = async (): Promise<string> => {
    const id = generateUuid();
    await testPrisma.payment.create({
      data: {
        id,
        amount: 100,
        status: 'PENDING',
        appointmentId,
        provider: 'MERCADO_PAGO',
        idempotencyKey: generateUuid(),
        gatewayPreferenceId: `3734273886-${generateUuid()}`,
      },
    });
    createdPaymentIds.push(id);
    return id;
  };

  /** Pago aprobado tal como lo devuelve `GET /v1/payments/{id}` */
  const approvedGatewayPayment = (gatewayPaymentId: string, paymentId: string) => ({
    id: Number(gatewayPaymentId),
    status: 'approved',
    status_detail: 'accredited',
    external_reference: paymentId,
    transaction_amount: 100,
    date_created: new Date().toISOString(),
    date_last_updated: new Date().toISOString(),
    live_mode: true,
    transaction_details: { total_refunded_amount: 0 },
  });

  /**
   * Body crudo de la notificación. Se arma como texto porque `JSON.stringify`
   * no puede escribir un entero mayor que `Number.MAX_SAFE_INTEGER` sin
   * redondearlo.
   */
  const notificationBody = (eventId: string, gatewayPaymentId: string): string =>
    `{"action":"payment.created","api_version":"v1","data":{"id":"${gatewayPaymentId}"},` +
    `"date_created":"${new Date().toISOString()}","id":${eventId},"live_mode":true,` +
    `"type":"payment","user_id":"3734273886"}`;

  /** Header `x-signature` con `ts` en segundos y el manifest de Mercado Pago */
  const signatureHeader = (gatewayPaymentId: string, requestId: string, secret: string): string => {
    const ts = String(Math.floor(Date.now() / 1000));
    const manifest = `id:${gatewayPaymentId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
    return `ts=${ts},v1=${v1}`;
  };

  const postNotification = (
    eventId: string,
    gatewayPaymentId: string,
    secret: string = WEBHOOK_SECRET,
  ) => {
    const requestId = generateUuid();
    return request(app)
      .post(`${WEBHOOK_PATH}?data.id=${gatewayPaymentId}&type=payment`)
      .set('x-signature', signatureHeader(gatewayPaymentId, requestId, secret))
      .set('x-request-id', requestId)
      .set('Content-Type', 'application/json')
      .send(notificationBody(eventId, gatewayPaymentId));
  };

  const findEvent = (eventId: string) =>
    testPrisma.paymentGatewayEvent.findUnique({
      where: { provider_eventId: { provider: 'MERCADO_PAGO', eventId } },
    });

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
    const appointment = await createConfirmedTestAppointment();
    appointmentId = appointment.id;
  });

  beforeEach(() => {
    mockMercadoPagoState.paymentsById.clear();
    mockMercadoPagoState.searchResultsByReference.clear();
    mockMercadoPagoState.calls.length = 0;
  });

  afterAll(async () => {
    await testPrisma.paymentGatewayEvent.deleteMany({
      where: { provider: 'MERCADO_PAGO', eventId: { in: createdEventIds } },
    });
    await testPrisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  });

  // ==========================================
  // WEBHOOK
  // ==========================================
  describe('POST /api/v1/payments/webhooks/mercadopago', () => {
    // Debería completar el pago a partir de una notificación firmada, consultar
    // el estado a la API con el token y registrar el evento con su id exacto
    it('should complete the payment from a signed notification', async () => {
      const paymentId = await createPendingGatewayPayment();
      const gatewayPaymentId = nextGatewayPaymentId();
      const eventId = nextEventId();
      mockMercadoPagoState.paymentsById.set(
        gatewayPaymentId,
        approvedGatewayPayment(gatewayPaymentId, paymentId),
      );

      const response = await postNotification(eventId, gatewayPaymentId);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });

      const payment = await testPrisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment?.status).toBe('COMPLETED');
      expect(payment?.gatewayPaymentId).toBe(gatewayPaymentId);
      expect(payment?.gatewayStatus).toBe('approved');
      expect(payment?.lastSyncedAt).not.toBeNull();

      const event = await findEvent(eventId);
      expect(event).not.toBeNull();
      expect(event?.status).toBe('PROCESSED');
      expect(event?.eventType).toBe('payment');
      expect(event?.paymentId).toBe(paymentId);
      expect(event?.signatureValid).toBe(true);
      expect(event?.processedAt).not.toBeNull();
      expect((event?.rawPayload as { id?: unknown }).id).toBe(eventId);

      expect(mockMercadoPagoState.calls).toHaveLength(1);
      expect(mockMercadoPagoState.calls[0]).toMatchObject({
        url: `${MERCADO_PAGO_API}/v1/payments/${gatewayPaymentId}`,
        method: 'GET',
      });
      expect(mockMercadoPagoState.calls[0].headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    });

    // Debería responder 200 a una notificación repetida sin volver a consultar
    // la API ni registrar un segundo evento
    it('should acknowledge a duplicate notification without processing it again', async () => {
      const paymentId = await createPendingGatewayPayment();
      const gatewayPaymentId = nextGatewayPaymentId();
      const eventId = nextEventId();
      mockMercadoPagoState.paymentsById.set(
        gatewayPaymentId,
        approvedGatewayPayment(gatewayPaymentId, paymentId),
      );

      const first = await postNotification(eventId, gatewayPaymentId);
      expect(first.status).toBe(200);
      mockMercadoPagoState.calls.length = 0;

      const duplicate = await postNotification(eventId, gatewayPaymentId);

      expect(duplicate.status).toBe(200);
      expect(duplicate.body).toEqual({ received: true });
      expect(mockMercadoPagoState.calls).toHaveLength(0);

      const events = await testPrisma.paymentGatewayEvent.count({
        where: { provider: 'MERCADO_PAGO', eventId },
      });
      expect(events).toBe(1);

      const payment = await testPrisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment?.status).toBe('COMPLETED');
    });

    // Debería rechazar con 401 una notificación firmada con otra clave, sin
    // registrar el evento, sin consultar la API y sin mover el pago
    it('should reject a notification signed with another secret', async () => {
      const paymentId = await createPendingGatewayPayment();
      const gatewayPaymentId = nextGatewayPaymentId();
      const eventId = nextEventId();
      mockMercadoPagoState.paymentsById.set(
        gatewayPaymentId,
        approvedGatewayPayment(gatewayPaymentId, paymentId),
      );

      const response = await postNotification(
        eventId,
        gatewayPaymentId,
        'another-application-webhook-secret',
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        received: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
      });
      expect(await findEvent(eventId)).toBeNull();
      expect(mockMercadoPagoState.calls).toHaveLength(0);

      const payment = await testPrisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment?.status).toBe('PENDING');
      expect(payment?.gatewayPaymentId).toBeNull();
    });
  });

  // ==========================================
  // SINCRONIZACIÓN
  // ==========================================
  describe('POST /api/v1/payments/:id/sync', () => {
    // Debería encontrar por referencia externa el pago de un checkout cuyo
    // webhook nunca llegó y quedarse con el aprobado aunque la búsqueda
    // devuelva primero un intento rechazado
    it('should sync a payment without gateway identifier by its external reference', async () => {
      const paymentId = await createPendingGatewayPayment();
      const approvedId = nextGatewayPaymentId();
      const rejectedId = nextGatewayPaymentId();
      mockMercadoPagoState.searchResultsByReference.set(paymentId, [
        {
          ...approvedGatewayPayment(rejectedId, paymentId),
          status: 'rejected',
          status_detail: 'cc_rejected_other_reason',
        },
        approvedGatewayPayment(approvedId, paymentId),
      ]);

      const response = await request(app)
        .post(`/api/v1/payments/${paymentId}/sync`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.changed).toBe(true);
      expect(response.body.data.payment.status).toBe('COMPLETED');

      const payment = await testPrisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment?.status).toBe('COMPLETED');
      expect(payment?.gatewayPaymentId).toBe(approvedId);
      expect(payment?.gatewayStatus).toBe('approved');

      expect(mockMercadoPagoState.calls).toHaveLength(1);
      const searchUrl = new URL(mockMercadoPagoState.calls[0].url);
      expect(searchUrl.pathname).toBe('/v1/payments/search');
      expect(searchUrl.searchParams.get('external_reference')).toBe(paymentId);
      expect(mockMercadoPagoState.calls[0].headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    });
  });
});
