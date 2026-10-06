/**
 * DTO de una notificación de webhook recibida de la pasarela de pago
 * @description Modela los cuatro datos del request que el procesamiento
 * necesita, ya extraídos por el controller. Son campos explícitos en vez de
 * los objetos crudos de Express, para que la capa de aplicación no dependa de
 * `express.Request` -- mismo criterio que `CreateCheckoutDto` con el header
 * `Idempotency-Key`. Los nombres coinciden con los de
 * `WebhookSignatureInput` (el tipo del puerto): son los mismos
 * valores, sin normalizar.
 */
export interface GatewayWebhookDto {
  /**
   * Body tal como llegó, sin tocar por ningún body-parser
   * @description Lo produce el `express.raw` propio del router del webhook.
   * Se conserva crudo por dos razones: se persiste como `rawPayload` del
   * `PaymentGatewayEvent` para auditoría y reproceso, y el puerto
   * `parseWebhookNotification(raw: Buffer)` queda agnóstico de proveedor
   * (Mercado Pago no firma el cuerpo, pero Stripe, GitHub y Shopify sí).
   */
  rawBody: Buffer;

  /**
   * Header `x-signature` tal como llegó (`ts=...,v1=...`), o `undefined` si
   * no vino
   */
  xSignature?: string;

  /**
   * Header `x-request-id` tal como llegó, o `undefined` si no vino
   */
  xRequestId?: string;

  /**
   * `data.id` de la query string (`?type=payment&data.id=...`), tal como
   * llegó -- sin pasar a minúsculas, eso lo hace el adapter al armar el
   * manifest
   */
  dataId?: string;
}
