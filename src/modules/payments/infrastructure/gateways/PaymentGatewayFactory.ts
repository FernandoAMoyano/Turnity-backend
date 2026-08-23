import { IPaymentGateway } from '../../domain/gateways/IPaymentGateway';
import { MercadoPagoGateway } from './MercadoPagoGateway';
import { NoopPaymentGateway } from './NoopPaymentGateway';
import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';

/**
 * Resuelve la implementación de `IPaymentGateway` a partir de
 * `PAYMENT_GATEWAY_PROVIDER`
 * @description Único punto donde se decide qué gateway usa la app.
 *  El resto del código depende solo de `IPaymentGateway`, nunca de esta
 * factory ni de las clases concretas -- mismo patrón que
 * `transportFactory.createEmailTransport`: una función, no una clase
 * estática, que lee `env` una sola vez y arma la implementación concreta.
 *
 * El `superRefine` de `env.ts` ya garantiza que `MERCADOPAGO_ACCESS_TOKEN`,
 * `MERCADOPAGO_WEBHOOK_SECRET` y `PUBLIC_API_URL` existen cuando
 * `PAYMENT_GATEWAY_PROVIDER=mercadopago`, así que el `?? ''` de abajo es solo
 * para satisfacer al compilador ante el tipo `optional()` de zod.
 * @returns La implementación concreta de `IPaymentGateway` a usar, sin
 * parámetros propios (lee todo de `env`, el módulo de configuración global
 * ya validado al arrancar la app): `NoopPaymentGateway` cuando
 * `env.PAYMENT_GATEWAY_PROVIDER === 'none'`, o `MercadoPagoGateway`
 * construido con `accessToken`/`webhookSecret`/`currency`/`publicApiUrl`/
 * `timeoutMs`/`signatureToleranceSeconds` leídos de `env` y `frontendUrl`
 * (variable ya existente, reusada tal cual) en caso contrario.
 */
export function createPaymentGateway(): IPaymentGateway {
  if (env.PAYMENT_GATEWAY_PROVIDER === 'none') {
    logger.info('[PaymentGatewayFactory] PAYMENT_GATEWAY_PROVIDER=none: NoopPaymentGateway activo');
    return new NoopPaymentGateway();
  }

  const gateway = new MercadoPagoGateway({
    accessToken: env.MERCADOPAGO_ACCESS_TOKEN ?? '',
    webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET ?? '',
    currency: env.PAYMENT_CURRENCY,
    publicApiUrl: env.PUBLIC_API_URL ?? '',
    frontendUrl: env.FRONTEND_URL,
    timeoutMs: env.PAYMENT_GATEWAY_TIMEOUT_MS,
    signatureToleranceSeconds: env.PAYMENT_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  });

  logger.info(
    '[PaymentGatewayFactory] PAYMENT_GATEWAY_PROVIDER=mercadopago: MercadoPagoGateway activo',
    { isSandbox: gateway.isSandbox },
  );

  return gateway;
}
