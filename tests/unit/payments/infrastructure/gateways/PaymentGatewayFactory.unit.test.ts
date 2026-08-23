/**
 * `createPaymentGateway` lee el módulo `env` a nivel de módulo (mismo patrón
 * que `transportFactory.createEmailTransport`), así que para cubrir ambas
 * ramas (`none` / `mercadopago`) se mockea `env` con `jest.doMock` y se
 * importa la factory en frío con `require` dentro de cada test, reseteando el
 * registro de módulos antes de cada uno.
 */
describe('createPaymentGateway', () => {
  const ENV_PATH = '../../../../../src/shared/config/env';
  const FACTORY_PATH =
    '../../../../../src/modules/payments/infrastructure/gateways/PaymentGatewayFactory';
  const NOOP_PATH =
    '../../../../../src/modules/payments/infrastructure/gateways/NoopPaymentGateway';
  const MP_PATH = '../../../../../src/modules/payments/infrastructure/gateways/MercadoPagoGateway';

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock(ENV_PATH);
  });

  // Debería devolver NoopPaymentGateway cuando PAYMENT_GATEWAY_PROVIDER=none
  it('should return a NoopPaymentGateway when PAYMENT_GATEWAY_PROVIDER is none', () => {
    jest.doMock(ENV_PATH, () => ({
      env: { PAYMENT_GATEWAY_PROVIDER: 'none' },
    }));

    // Ver el comentario del describe: jest.resetModules() + jest.doMock()
    // exige un require() sincrónico dentro de cada test para que el módulo
    // se reevalúe con el mock activo; un import estático de nivel de
    // archivo se resolvería una sola vez, antes del doMock, y siempre
    // devolvería el env real.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NoopPaymentGateway } = require(NOOP_PATH);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPaymentGateway } = require(FACTORY_PATH);

    const gateway = createPaymentGateway();

    expect(gateway).toBeInstanceOf(NoopPaymentGateway);
  });

  // Debería devolver MercadoPagoGateway configurado desde env cuando el provider es mercadopago
  it('should return a MercadoPagoGateway configured from env when the provider is mercadopago', () => {
    jest.doMock(ENV_PATH, () => ({
      env: {
        PAYMENT_GATEWAY_PROVIDER: 'mercadopago',
        MERCADOPAGO_ACCESS_TOKEN: 'TEST-abcdefghijklmnopqrstuvwxyz',
        MERCADOPAGO_WEBHOOK_SECRET: 'a-secret-with-16-chars-min',
        PAYMENT_CURRENCY: 'ARS',
        PUBLIC_API_URL: 'https://api.turnity.com',
        FRONTEND_URL: 'https://turnity.com',
        PAYMENT_GATEWAY_TIMEOUT_MS: 10000,
        PAYMENT_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS: 300,
      },
    }));

    // Mismo motivo que en el test anterior.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MercadoPagoGateway } = require(MP_PATH);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPaymentGateway } = require(FACTORY_PATH);

    const gateway = createPaymentGateway();

    expect(gateway).toBeInstanceOf(MercadoPagoGateway);
    expect(gateway.isSandbox).toBe(true);
  });
});
