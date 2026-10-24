import { AppError } from '../../../../shared/exceptions/AppError';
import { PaymentGatewayError } from '../../domain/gateways/PaymentGatewayError';

/**
 * Mensajes con los que un caso de uso describe el fallo de la pasarela
 */
export interface GatewayFailureMessages {
  /** Para un fallo pasajero, que puede resolverse reintentando más tarde */
  retryable: string;
  /** Para un rechazo del proveedor que no se resuelve reintentando */
  rejected: string;
}

/**
 * Mensaje para un rechazo de credenciales por parte del proveedor
 * @description No invita a reintentar: el problema está en la configuración de
 * este servidor, y el mismo pedido va a fallar igual hasta que se corrija.
 */
const CREDENTIALS_REJECTED_MESSAGE =
  'The payment gateway rejected the credentials configured on this server. Check the payment gateway configuration.';

/**
 * Traduce un fallo de la pasarela al error que devuelve la API
 * @description Un `AppError` se devuelve tal cual: sin pasarela configurada el
 * fallo es de este servidor y ya trae su propio status. Cualquier otro fallo
 * es del proveedor externo y se responde con 502, con un mensaje que depende
 * de si reintentar tiene sentido. Un error que no es `PaymentGatewayError` se
 * trata como pasajero, porque no hay información para afirmar lo contrario.
 * @param error - Lo que lanzó la llamada a la pasarela
 * @param messages - Mensajes propios del caso de uso
 * @returns El error a lanzar
 */
export function translateGatewayFailure(
  error: unknown,
  messages: GatewayFailureMessages,
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof PaymentGatewayError && error.isCredentialsError) {
    return new AppError(CREDENTIALS_REJECTED_MESSAGE, 502, 'BUSINESS_RULE_ERROR');
  }

  if (error instanceof PaymentGatewayError && !error.isRetryable) {
    return new AppError(messages.rejected, 502, 'BUSINESS_RULE_ERROR');
  }

  return new AppError(messages.retryable, 502, 'BUSINESS_RULE_ERROR');
}
