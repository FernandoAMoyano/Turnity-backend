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
   * Monto que se va a cobrar, en la unidad monetaria base
   * @description Lo calcula el servidor a partir de los servicios de la cita.
   * Se devuelve para que el frontend pueda mostrarlo antes de redirigir al
   * pagador.
   * @example 85.5
   */
  amount: number;

  /**
   * URL de checkout hospedado a la que se redirige al pagador
   */
  checkoutUrl: string;

  /**
   * Identificador de la preferencia en la pasarela
   */
  gatewayPreferenceId: string;

  /**
   * Vencimiento de la preferencia, tal como lo informó la pasarela al crearla
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
