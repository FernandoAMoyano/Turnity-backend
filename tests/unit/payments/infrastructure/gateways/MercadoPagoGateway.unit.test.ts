import { createHmac } from 'node:crypto';
import {
  MercadoPagoGateway,
  MercadoPagoGatewayConfig,
} from '../../../../../src/modules/payments/infrastructure/gateways/MercadoPagoGateway';
import { logger } from '../../../../../src/shared/logger/logger';

/**
 * Construye un fetch fake con una cola de respuestas. Cada llamada consume la
 * siguiente respuesta de la cola; si se acaban, repite la última.
 */
function makeFakeFetch(responses: Array<{ ok: boolean; status: number; body?: unknown; text?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;

  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const spec = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      ok: spec.ok,
      status: spec.status,
      json: async () => spec.body,
      text: async () => spec.text ?? JSON.stringify(spec.body ?? {}),
    } as unknown as Response;
  });

  return { fetchImpl, calls };
}

const SECRET = 'a-webhook-secret-with-enough-entropy';

/** Firma un manifest exactamente como lo hace el adapter, para armar fixtures de test */
function signManifest(secret: string, ts: string, dataId?: string, requestId?: string): string {
  const lines: string[] = [];
  if (dataId) lines.push(`id:${dataId.toLowerCase()}`);
  if (requestId) lines.push(`request-id:${requestId}`);
  lines.push(`ts:${ts}`);
  const manifest = `${lines.join(';')};`;
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

function baseConfig(overrides: Partial<MercadoPagoGatewayConfig> = {}): MercadoPagoGatewayConfig {
  return {
    accessToken: 'TEST-1234567890-fake-access-token',
    webhookSecret: SECRET,
    currency: 'ARS',
    publicApiUrl: 'https://api.turnity.com',
    frontendUrl: 'https://turnity.com',
    timeoutMs: 5000,
    signatureToleranceSeconds: 300,
    ...overrides,
  };
}

describe('MercadoPagoGateway', () => {
  describe('isSandbox', () => {
    // Debería derivar sandbox del prefijo TEST- del access token
    it('should be true for a TEST- access token', () => {
      const gateway = new MercadoPagoGateway(baseConfig({ accessToken: 'TEST-abc' }));
      expect(gateway.isSandbox).toBe(true);
    });

    // Debería derivar produccion de un access token APP_USR-
    it('should be false for an APP_USR- access token', () => {
      const gateway = new MercadoPagoGateway(baseConfig({ accessToken: 'APP_USR-abc' }));
      expect(gateway.isSandbox).toBe(false);
    });
  });

  describe('createCheckout', () => {
    // Debería crear la preferencia con los headers, la URL sandbox y los datos correctos
    it('should create the preference and return the sandbox checkout URL', async () => {
      const { fetchImpl, calls } = makeFakeFetch([
        {
          ok: true,
          status: 201,
          body: {
            id: 'pref-123',
            init_point: 'https://mercadopago.com/checkout/prod',
            sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/sandbox',
          },
        },
      ]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      const result = await gateway.createCheckout({
        paymentId: 'payment-1',
        amount: 1500.5,
        description: 'Turno de corte',
        idempotencyKey: 'idem-1',
      });

      expect(result.gatewayPreferenceId).toBe('pref-123');
      expect(result.checkoutUrl).toBe('https://sandbox.mercadopago.com/checkout/sandbox');
      expect(result.expiresAt).toBeInstanceOf(Date);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.mercadopago.com/checkout/preferences');
      const init = calls[0].init as RequestInit;
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer TEST-1234567890-fake-access-token',
      );
      expect((init.headers as Record<string, string>)['X-Idempotency-Key']).toBe('idem-1');
      const body = JSON.parse(init.body as string);
      expect(body.external_reference).toBe('payment-1');
      expect(body.items[0].unit_price).toBe(1500.5);
      expect(body.items[0].currency_id).toBe('ARS');
      expect(body.notification_url).toBe(
        'https://api.turnity.com/api/v1/payments/webhooks/mercadopago',
      );
    });

    // Debería devolver la URL de produccion cuando el token no es de sandbox
    it('should return the production checkout URL for a non-sandbox token', async () => {
      const { fetchImpl } = makeFakeFetch([
        {
          ok: true,
          status: 201,
          body: {
            id: 'pref-123',
            init_point: 'https://mercadopago.com/checkout/prod',
            sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/sandbox',
          },
        },
      ]);
      const gateway = new MercadoPagoGateway(
        baseConfig({ accessToken: 'APP_USR-real-token' }),
        fetchImpl as unknown as typeof fetch,
      );

      const result = await gateway.createCheckout({
        paymentId: 'payment-1',
        amount: 100,
        description: 'Turno',
        idempotencyKey: 'idem-1',
      });

      expect(result.checkoutUrl).toBe('https://mercadopago.com/checkout/prod');
    });

    // Debería lanzar un error ante un 4xx, sin reintentar
    it('should throw on a 4xx without retrying', async () => {
      const { fetchImpl } = makeFakeFetch([{ ok: false, status: 400, text: '{"message":"bad request"}' }]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      await expect(
        gateway.createCheckout({
          paymentId: 'payment-1',
          amount: 100,
          description: 'Turno',
          idempotencyKey: 'idem-1',
        }),
      ).rejects.toThrow();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPayment', () => {
    // Debería mapear la respuesta de MP a GatewayPaymentSnapshot
    it('should map the MercadoPago response to a GatewayPaymentSnapshot', async () => {
      const { fetchImpl } = makeFakeFetch([
        {
          ok: true,
          status: 200,
          body: {
            id: 987654,
            status: 'approved',
            status_detail: 'accredited',
            external_reference: 'payment-1',
            transaction_amount: 1500.5,
            date_last_updated: '2026-01-01T12:00:00.000-04:00',
            transaction_details: { total_refunded_amount: 0 },
          },
        },
      ]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      const snapshot = await gateway.getPayment('987654');

      expect(snapshot).not.toBeNull();
      expect(snapshot?.gatewayPaymentId).toBe('987654');
      expect(snapshot?.status).toBe('approved');
      expect(snapshot?.statusDetail).toBe('accredited');
      expect(snapshot?.externalReference).toBe('payment-1');
      expect(snapshot?.amount).toBe(1500.5);
      expect(snapshot?.gatewayUpdatedAt).toBeInstanceOf(Date);
    });

    // Debería devolver null ante un 404
    it('should return null on a 404', async () => {
      const { fetchImpl } = makeFakeFetch([{ ok: false, status: 404 }]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      const snapshot = await gateway.getPayment('unknown-id');

      expect(snapshot).toBeNull();
    });

    // Debería reintentar una vez ante un 5xx
    it('should retry once on a 5xx', async () => {
      const { fetchImpl } = makeFakeFetch([
        { ok: false, status: 503, text: 'service unavailable' },
        { ok: true, status: 200, body: { id: 1, status: 'approved' } },
      ]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      const snapshot = await gateway.getPayment('1');

      expect(snapshot?.status).toBe('approved');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    // Debería lanzar un error tras agotar el único reintento ante 5xx persistente
    it('should throw after exhausting the single retry on persistent 5xx', async () => {
      const { fetchImpl } = makeFakeFetch([
        { ok: false, status: 500, text: 'error 1' },
        { ok: false, status: 500, text: 'error 2' },
      ]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      await expect(gateway.getPayment('1')).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    // No debería filtrar el access token en los logs de error
    it('should not leak the access token in error logs', async () => {
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
      const { fetchImpl } = makeFakeFetch([
        { ok: false, status: 500, text: 'error' },
        { ok: false, status: 500, text: 'error' },
      ]);
      const gateway = new MercadoPagoGateway(
        baseConfig({ accessToken: 'TEST-super-secret-token-value' }),
        fetchImpl as unknown as typeof fetch,
      );

      await expect(gateway.getPayment('1')).rejects.toThrow();

      const loggedText = JSON.stringify(errorSpy.mock.calls);
      expect(loggedText).not.toContain('TEST-super-secret-token-value');

      errorSpy.mockRestore();
    });
  });

  describe('refund', () => {
    // Debería mapear un reembolso aprobado
    it('should map an approved refund', async () => {
      const { fetchImpl } = makeFakeFetch([
        { ok: true, status: 201, body: { id: 555, amount: 1500.5, status: 'approved' } },
      ]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      const result = await gateway.refund('987654', 'idem-refund-1');

      expect(result).toEqual({ gatewayRefundId: '555', amount: 1500.5, status: 'approved' });
    });

    // Debería mapear cualquier estado que no sea approved como pending
    it('should map any non-approved status as pending', async () => {
      const { fetchImpl } = makeFakeFetch([
        { ok: true, status: 201, body: { id: 555, amount: 1500.5, status: 'in_process' } },
      ]);
      const gateway = new MercadoPagoGateway(baseConfig(), fetchImpl as unknown as typeof fetch);

      const result = await gateway.refund('987654', 'idem-refund-1');

      expect(result.status).toBe('pending');
    });
  });

  describe('verifyWebhookSignature', () => {
    const dataId = 'MP123456';
    const xRequestId = 'req-abc-123';

    // Debería validar una firma correcta
    it('should return true for a valid signature', () => {
      const ts = String(Date.now());
      const v1 = signManifest(SECRET, ts, dataId, xRequestId);
      const gateway = new MercadoPagoGateway(baseConfig());

      const result = gateway.verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId,
        dataId,
      });

      expect(result).toBe(true);
    });

    // data.id debe normalizarse a minusculas antes de firmar (verificado contra doc de MP)
    it('should validate correctly when dataId arrives in uppercase', () => {
      const ts = String(Date.now());
      const v1 = signManifest(SECRET, ts, dataId, xRequestId); // firmado con dataId ya en minúsculas
      const gateway = new MercadoPagoGateway(baseConfig());

      const result = gateway.verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId,
        dataId: dataId.toUpperCase(),
      });

      expect(result).toBe(true);
    });

    // Debería rechazar si el v1 fue alterado
    it('should return false when v1 is tampered', () => {
      const ts = String(Date.now());
      const v1 = signManifest(SECRET, ts, dataId, xRequestId);
      const tampered = v1.slice(0, -1) + (v1.at(-1) === '0' ? '1' : '0');
      const gateway = new MercadoPagoGateway(baseConfig());

      const result = gateway.verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${tampered}`,
        xRequestId,
        dataId,
      });

      expect(result).toBe(false);
    });

    // Debería rechazar si ts está fuera de la ventana de tolerancia
    it('should return false when ts is outside the tolerance window', () => {
      const staleTs = String(Date.now() - 10 * 60 * 1000); // 10 minutos atrás
      const v1 = signManifest(SECRET, staleTs, dataId, xRequestId);
      const gateway = new MercadoPagoGateway(baseConfig({ signatureToleranceSeconds: 300 }));

      const result = gateway.verifyWebhookSignature({
        xSignature: `ts=${staleTs},v1=${v1}`,
        xRequestId,
        dataId,
      });

      expect(result).toBe(false);
    });

    // Debería rechazar sin lanzar un error si falta el header x-signature
    it('should return false without throwing when x-signature is missing', () => {
      const gateway = new MercadoPagoGateway(baseConfig());

      expect(() =>
        gateway.verifyWebhookSignature({ xSignature: undefined, xRequestId, dataId }),
      ).not.toThrow();
      expect(
        gateway.verifyWebhookSignature({ xSignature: undefined, xRequestId, dataId }),
      ).toBe(false);
    });

    // Debería rechazar sin lanzar un error si x-signature está malformado (sin ts o sin v1)
    it('should return false without throwing when x-signature is malformed', () => {
      const gateway = new MercadoPagoGateway(baseConfig());

      expect(
        gateway.verifyWebhookSignature({ xSignature: 'garbage-value', xRequestId, dataId }),
      ).toBe(false);
      expect(
        gateway.verifyWebhookSignature({ xSignature: 'ts=123456', xRequestId, dataId }),
      ).toBe(false);
    });

    // timingSafeEqual: un v1 de longitud distinta a la esperada no debe lanzar
    // un error (debe resolver a false)
    it('should return false without throwing when v1 has a different length', () => {
      const ts = String(Date.now());
      const gateway = new MercadoPagoGateway(baseConfig());

      expect(() =>
        gateway.verifyWebhookSignature({
          xSignature: `ts=${ts},v1=deadbeef`,
          xRequestId,
          dataId,
        }),
      ).not.toThrow();
      expect(
        gateway.verifyWebhookSignature({
          xSignature: `ts=${ts},v1=deadbeef`,
          xRequestId,
          dataId,
        }),
      ).toBe(false);
    });

    // Debería omitir la línea del manifest para un valor ausente en vez de dejarla vacía
    it('should omit the manifest line for a missing value instead of leaving it empty', () => {
      const ts = String(Date.now());
      const v1 = signManifest(SECRET, ts, undefined, xRequestId); // sin dataId
      const gateway = new MercadoPagoGateway(baseConfig());

      const result = gateway.verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId,
        dataId: undefined,
      });

      expect(result).toBe(true);
    });

    // ==========================================
    // UNIDAD DEL ts
    // ==========================================
    // La documentación de Mercado Pago se contradice sobre este campo: unas
    // páginas dan el ts en segundos (10 dígitos) y otras en milisegundos (13).
    // Con la unidad equivocada, la antigüedad calculada se va a años y el
    // webhook rechaza notificaciones válidas, así que estos tests fijan que
    // las dos unidades entran por la ventana de tolerancia.

    // Debería aceptar un ts en segundos (10 dígitos) dentro de la ventana
    it('should accept a ts expressed in seconds', () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const v1 = signManifest(SECRET, ts, dataId, xRequestId);
      const gateway = new MercadoPagoGateway(baseConfig());

      const result = gateway.verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId,
        dataId,
      });

      expect(result).toBe(true);
    });

    // Debería rechazar un ts en segundos fuera de la ventana de tolerancia:
    // la normalización no debe volver permisiva la ventana
    it('should reject a stale ts expressed in seconds', () => {
      const staleTs = String(Math.floor(Date.now() / 1000) - 10 * 60); // 10 minutos atrás
      const v1 = signManifest(SECRET, staleTs, dataId, xRequestId);
      const gateway = new MercadoPagoGateway(baseConfig());

      const result = gateway.verifyWebhookSignature({
        xSignature: `ts=${staleTs},v1=${v1}`,
        xRequestId,
        dataId,
      });

      expect(result).toBe(false);
    });

    // Debería rechazar un ts que no es un número, sin lanzar una excepción
    it('should return false for a non-numeric ts', () => {
      const gateway = new MercadoPagoGateway(baseConfig());
      const v1 = signManifest(SECRET, 'not-a-number', dataId, xRequestId);

      expect(
        gateway.verifyWebhookSignature({
          xSignature: `ts=not-a-number,v1=${v1}`,
          xRequestId,
          dataId,
        }),
      ).toBe(false);
    });
  });

  describe('parseWebhookNotification', () => {
    // Debería parsear una notificación bien formada
    it('should parse a well-formed notification', () => {
      const gateway = new MercadoPagoGateway(baseConfig());
      const raw = Buffer.from(
        JSON.stringify({ type: 'payment', id: 123456, data: { id: 'MP987654' } }),
      );

      const notification = gateway.parseWebhookNotification(raw);

      expect(notification).toEqual({
        eventType: 'payment',
        eventId: '123456',
        resourceId: 'MP987654',
      });
    });

    // Debería lanzar un error ante JSON inválido
    it('should throw on invalid JSON', () => {
      const gateway = new MercadoPagoGateway(baseConfig());
      const raw = Buffer.from('not-json{{{');

      expect(() => gateway.parseWebhookNotification(raw)).toThrow();
    });

    // Debería lanzar un error si falta data.id
    it('should throw when data.id is missing', () => {
      const gateway = new MercadoPagoGateway(baseConfig());
      const raw = Buffer.from(JSON.stringify({ type: 'payment', id: 1, data: {} }));

      expect(() => gateway.parseWebhookNotification(raw)).toThrow();
    });
  });
});
