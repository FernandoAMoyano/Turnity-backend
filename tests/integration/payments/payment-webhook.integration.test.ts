import request from 'supertest';
import { createHmac } from 'crypto';
import app from '../../../src/app';
import { testPrisma } from '../../setup/database';

const WEBHOOK_PATH = '/api/v1/payments/webhooks/mercadopago';

/**
 * Tests de integración del webhook de la pasarela de pago.
 *
 * **Qué prueba este archivo y qué no.** En este entorno `.env` no define
 * `PAYMENT_GATEWAY_PROVIDER`, así que aplica el default `'none'` de `env.ts` y
 * `PaymentContainer` cablea `NoopPaymentGateway`, cuyo
 * `verifyWebhookSignature` devuelve `false` siempre. Es decir: por HTTP,
 * cualquier notificación termina en 401. Eso NO es una limitación de estos
 * tests, es la razón de ser de ellos: lo que hay que probar acá es la
 * **plomería** -- que la request llega hasta el controller del webhook sin que
 * nada aguas arriba la bloquee antes, y que el body llega crudo con el límite
 * correcto. La lógica de `HandleGatewayWebhook` (incluido el camino feliz
 * `approved` -> `COMPLETED`) se prueba completa a nivel unitario con
 * `FakePaymentGateway`, mismo criterio que ya se aplicó al checkout. El
 * camino feliz por HTTP real queda para cuando haya credenciales de sandbox.
 *
 * **Cómo se prueba la exclusión de middleware sin poder llegar al 200.** El
 * 401 del webhook es distinguible del de `AuthMiddleware`: el del webhook
 * responde `{ received: false, code: 'UNAUTHORIZED' }`, y el de
 * `AuthMiddleware` responde `{ success: false, message: 'Access token is
 * required' }`. Si el 401 que vuelve es el del webhook, la request atravesó
 * toda la cadena y llegó al controller -- que es exactamente la propiedad que
 * hay que verificar.
 */
describe('Payment Webhook Integration Tests', () => {
  /** Payload mínimo válido de una notificación de Mercado Pago */
  const notificationBody = {
    id: 123456789,
    live_mode: false,
    type: 'payment',
    date_created: '2026-09-03T10:04:58.396-03:00',
    user_id: 44444,
    api_version: 'v1',
    action: 'payment.updated',
    data: { id: 'abc123' },
  };

  /**
   * Firma un manifest con el mismo algoritmo del adapter. El secreto es
   * arbitrario: con `NoopPaymentGateway` la firma se rechaza igual, y lo que
   * importa acá es que el header tenga la FORMA correcta para que ninguna
   * capa anterior lo rechace por malformado.
   */
  const signedHeader = (dataId: string, requestId: string): string => {
    const ts = String(Date.now());
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', 'integration_test_webhook_secret')
      .update(manifest)
      .digest('hex');
    return `ts=${ts},v1=${v1}`;
  };

  const postNotification = (dataId = 'abc123', requestId = 'req-integration-1') =>
    request(app)
      .post(`${WEBHOOK_PATH}?type=payment&data.id=${dataId}`)
      .set('x-signature', signedHeader(dataId, requestId))
      .set('x-request-id', requestId)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...notificationBody, data: { id: dataId } }));

  // ==========================================
  // LA RUTA EXISTE Y ESTÁ MONTADA
  // ==========================================
  describe('Ruta montada', () => {
    // Debería existir la ruta: no debe caer en el catch-all 404 de app.ts
    it('should expose the webhook route', async () => {
      const response = await postNotification();

      expect(response.status).not.toBe(404);
      expect(response.body.code).not.toBe('ROUTE_NOT_FOUND');
    });

    // Debería responder con el shape del webhook y no con el del resto de la
    // API: la audiencia es una máquina, no un usuario
    it('should answer with the webhook response shape', async () => {
      const response = await postNotification();

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        received: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
      });
    });
  });

  // ==========================================
  // EXCLUSIÓN DE MIDDLEWARE
  // ==========================================
  describe('Exclusión de middleware', () => {
    // Debería llegar al controller sin header Authorization: prueba que
    // authenticate/authorize no están en la cadena de esta ruta
    it('should not require an Authorization header', async () => {
      const response = await postNotification();

      // El 401 que vuelve es el del webhook, no el de AuthMiddleware
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(response.body.message).not.toBe('Access token is required');
      expect(response.body.message).not.toBe('Invalid or expired token');
      expect(response.body.success).toBeUndefined();
    });

    // Debería llegar al controller sin cookie ni header CSRF: prueba que
    // csrfProtection no está en la cadena (daría 403 en todos los ambientes)
    it('should not require a CSRF token', async () => {
      const response = await postNotification();

      expect(response.status).not.toBe(403);
      expect(response.body.message).not.toBe('Invalid or missing CSRF token');
    });

    // Debería aceptar una ráfaga sin devolver 429: prueba que no hay rate
    // limiter. Los limiters de auth se auto-desactivan con NODE_ENV=test, así
    // que este test documenta la intención y detecta si alguien agrega uno
    // con un skip distinto.
    it('should not rate limit a burst of notifications', async () => {
      const responses = [];
      for (let i = 0; i < 30; i += 1) {
        responses.push(await postNotification('abc123', `req-burst-${i}`));
      }

      expect(responses).toHaveLength(30);
      expect(responses.every((response) => response.status !== 429)).toBe(true);
    });
  });

  // ==========================================
  // BODY CRUDO Y ORDEN EN app.ts (R1)
  // ==========================================
  describe('Body crudo y orden de middlewares', () => {
    // Debería rechazar con 413 un payload que excede 1 MB.
    //
    // Este es EL test del orden de middlewares en app.ts. El express.json
    // global tiene límite de 10 MB: si estuviera interceptando esta ruta, un
    // payload de 1.5 MB se parsearía sin problema y la respuesta sería 401
    // (firma rechazada por Noop). El 413 solo puede venir del express.raw de
    // 1 MB del router del webhook, y ese router solo se alcanza si está
    // montado ANTES del parser global.
    it('should reject a payload over the 1mb limit with 413', async () => {
      const oversized = JSON.stringify({
        ...notificationBody,
        padding: 'x'.repeat(1_500_000),
      });

      const response = await request(app)
        .post(`${WEBHOOK_PATH}?type=payment&data.id=abc123`)
        .set('x-signature', signedHeader('abc123', 'req-oversized'))
        .set('x-request-id', 'req-oversized')
        .set('Content-Type', 'application/json')
        .send(oversized);

      expect(response.status).toBe(413);
      expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
    });

    // Debería aceptar un payload con unicode y espaciado no canónico sin
    // romperse al leerlo crudo. Nota: el manifest de Mercado Pago NO incluye
    // el cuerpo (es `id;request-id;ts`), así que esto no prueba nada sobre el
    // HMAC -- prueba que el express.raw entrega los bytes tal cual y que el
    // pipeline los procesa sin fallar.
    it('should accept a non-canonical unicode payload', async () => {
      const nonCanonical = `{\n  "id" :  123456789 ,\n  "type":"payment",\n  "action": "payment.updated",\n  "descripción": "Corte + color — ñandú 😀",\n  "data" : { "id" : "abc123" }\n}`;

      const response = await request(app)
        .post(`${WEBHOOK_PATH}?type=payment&data.id=abc123`)
        .set('x-signature', signedHeader('abc123', 'req-unicode'))
        .set('x-request-id', 'req-unicode')
        .set('Content-Type', 'application/json')
        .send(nonCanonical);

      // 401 por Noop, no 400/500: el body llegó y se procesó sin excepción
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    // Debería rechazar con 401 cuando el Content-Type no matchea el
    // express.raw: en ese caso Express deja req.body en {} y no hay cuerpo
    // crudo que verificar ni auditar
    it('should reject a request whose content type does not match', async () => {
      const response = await request(app)
        .post(`${WEBHOOK_PATH}?type=payment&data.id=abc123`)
        .set('x-signature', signedHeader('abc123', 'req-wrong-ct'))
        .set('x-request-id', 'req-wrong-ct')
        .set('Content-Type', 'text/plain')
        .send('not json');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });

  // ==========================================
  // FIRMA: LA ÚNICA BARRERA
  // ==========================================
  describe('Verificación de firma', () => {
    // Debería responder 401 sin el header x-signature
    it('should return 401 when x-signature is missing', async () => {
      const response = await request(app)
        .post(`${WEBHOOK_PATH}?type=payment&data.id=abc123`)
        .set('x-request-id', 'req-no-signature')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(notificationBody));

      expect(response.status).toBe(401);
      expect(response.body.received).toBe(false);
    });

    // Debería responder 401 con un x-signature malformado, sin lanzar una excepción
    it('should return 401 when x-signature is malformed', async () => {
      const response = await request(app)
        .post(`${WEBHOOK_PATH}?type=payment&data.id=abc123`)
        .set('x-signature', 'esto-no-es-una-firma')
        .set('x-request-id', 'req-bad-signature')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(notificationBody));

      expect(response.status).toBe(401);
      expect(response.body.received).toBe(false);
    });

    // Debería NO escribir ningún evento en la base cuando la firma se
    // rechaza: la verificación ocurre antes de cualquier I/O
    it('should not write any gateway event when the signature is rejected', async () => {
      const eventId = String(Date.now());

      await request(app)
        .post(`${WEBHOOK_PATH}?type=payment&data.id=abc123`)
        .set('x-signature', signedHeader('abc123', 'req-no-writes'))
        .set('x-request-id', 'req-no-writes')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ ...notificationBody, id: eventId }));

      const events = await testPrisma.paymentGatewayEvent.findMany({
        where: { eventId },
      });

      expect(events).toHaveLength(0);
    });
  });
});
