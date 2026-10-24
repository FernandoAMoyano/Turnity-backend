import {
  MercadoPagoGateway,
  MercadoPagoGatewayConfig,
} from '../../../../../src/modules/payments/infrastructure/gateways/MercadoPagoGateway';

const config: MercadoPagoGatewayConfig = {
  accessToken: 'APP_USR-1234567890-fake-access-token',
  webhookSecret: 'a-webhook-secret-with-enough-entropy',
  currency: 'ARS',
  frontendUrl: 'https://turnity.com',
  timeoutMs: 5000,
  signatureToleranceSeconds: 300,
};

describe('MercadoPagoGateway - Medios de pago del checkout', () => {
  // Debería excluir de la preferencia los pagos en efectivo y los que no se acreditan en el momento
  it('should exclude cash and other non-instant payment types from the preference', async () => {
    const requestBodies: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      requestBodies.push(init.body as string);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'pref-123',
          init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123',
          sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect',
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const gateway = new MercadoPagoGateway(config, fetchImpl);

    await gateway.createCheckout({
      paymentId: 'payment-1',
      amount: 85,
      description: 'Turno',
      idempotencyKey: 'idem-1',
    });

    const body = JSON.parse(requestBodies[0]);
    expect(body.payment_methods).toEqual({
      excluded_payment_types: [
        { id: 'ticket' },
        { id: 'atm' },
        { id: 'bank_transfer' },
        { id: 'digital_currency' },
      ],
    });
  });
});
