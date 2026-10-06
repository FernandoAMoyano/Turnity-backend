/**
 * DTO para crear un checkout contra la pasarela de pago
 * @description Contiene los datos necesarios para abrir una intención de
 * cobro (preferencia) en la pasarela. `idempotencyKey` no viaja en el body:
 * la arma el controller a partir del header `Idempotency-Key` (o, si no se
 * envía, `CreateCheckout` genera una) -- se modela igual acá para que el
 * caso de uso no dependa de Express.
 */
export interface CreateCheckoutDto {
  /**
   * ID de la cita a pagar
   */
  appointmentId: string;

  /**
   * Monto a cobrar, en la unidad monetaria base (coincide con Payment.amount)
   * @example 1500.50
   */
  amount: number;

  /**
   * Descripción visible para el pagador en el checkout hospedado (opcional)
   * @example 'Corte + color - Turno 2026-09-05 15:00'
   */
  description?: string;

  /**
   * Clave de idempotencia hacia la pasarela, tomada del header
   * `Idempotency-Key` si el cliente la envía. Evita crear una segunda
   * preferencia ante un reintento.
   */
  idempotencyKey?: string;
}
