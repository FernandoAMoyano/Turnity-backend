import { PaymentProviderEnum, PaymentStatusEnum } from '../../../domain/entities/Payment';

/**
 * DTO de respuesta para un checkout recién creado
 * @description No es un `PaymentResponseDto`: el checkout es una operación
 * (crear una intención de cobro), no una lectura de pago, y su respuesta
 * incluye `checkoutUrl` -- el dato que el frontend necesita para redirigir
 * al pagador -- que `GET /payments/:id` no está obligado a exponer siempre.
 */
export interface CheckoutResponseDto {
  /**
   * ID del `Payment` local creado (o reutilizado, si la `Idempotency-Key` ya
   * había sido usada)
   */
  paymentId: string;

  /**
   * URL de checkout hospedado a la que se redirige al pagador
   */
  checkoutUrl: string;

  /**
   * Identificador de la preferencia en la pasarela
   */
  gatewayPreferenceId: string;

  /**
   * Vencimiento de la preferencia (D6: 30 minutos desde su creación).
   * No se persiste en `Payment` -- se recalcula acá a partir de lo que
   * devuelve la pasarela en el momento de crear el checkout.
   */
  expiresAt: Date;

  /**
   * Estado del pago recién creado (siempre PENDING en la respuesta 201/200
   * de este endpoint)
   */
  status: PaymentStatusEnum;

  /**
   * Proveedor que va a procesar el cobro
   */
  provider: PaymentProviderEnum;
}
