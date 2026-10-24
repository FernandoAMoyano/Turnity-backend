import {
  MercadoPagoGateway,
  MercadoPagoGatewayConfig,
} from '../../../../../src/modules/payments/infrastructure/gateways/MercadoPagoGateway';
import { PaymentGatewayError } from '../../../../../src/modules/payments/domain/gateways/PaymentGatewayError';

const config: MercadoPagoGatewayConfig = {
  accessToken: 'APP_USR-1234567890-fake-access-token',
  webhookSecret: 'a-webhook-secret-with-enough-entropy',
  currency: 'ARS',
  frontendUrl: 'https://turnity.com',
  timeoutMs: 5000,
  signatureToleranceSeconds: 300,
};

/**
 * Fetch que responde siempre con el mismo status de error
 */
function failingFetch(status: number): typeof fetch {
  return (async () =>
    ({
      ok: false,
      status,
      json: async () => ({}),
      text: async () => '{"message":"error"}',
    }) as unknown as Response) as unknown as typeof fetch;
}

/**
 * Fetch que nunca llega a obtener una respuesta
 */
function unreachableFetch(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
}

describe('MercadoPagoGateway - Errores tipados', () => {
  // Debería lanzar PaymentGatewayError con el status de Mercado Pago ante un 4xx
  it('should throw a PaymentGatewayError with the Mercado Pago status on a 4xx', async () => {
    const gateway = new MercadoPagoGateway(config, failingFetch(401));

    const error = await gateway.refund('181041671799', 'refund-key').catch((caught) => caught);

    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error.providerStatus).toBe(401);
    expect(error.isCredentialsError).toBe(true);
    expect(error.message).toMatch(/HTTP 401/);
  });

  // Debería lanzar PaymentGatewayError con el status de Mercado Pago tras agotar el reintento ante un 5xx
  it('should throw a PaymentGatewayError with the Mercado Pago status after the retry on a 5xx', async () => {
    const gateway = new MercadoPagoGateway(config, failingFetch(503));

    const error = await gateway
      .createCheckout({
        paymentId: 'payment-1',
        amount: 100,
        description: 'Turno',
        idempotencyKey: 'idem-1',
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error.providerStatus).toBe(503);
    expect(error.isRetryable).toBe(true);
  });

  // Debería lanzar PaymentGatewayError sin status cuando la llamada nunca obtiene respuesta
  it('should throw a PaymentGatewayError without a status when the call never gets a response', async () => {
    const gateway = new MercadoPagoGateway(config, unreachableFetch());

    const error = await gateway.getPayment('181041671799').catch((caught) => caught);

    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error.providerStatus).toBeUndefined();
    expect(error.isRetryable).toBe(true);
    expect(error.message).toContain('fetch failed');
  });
});
