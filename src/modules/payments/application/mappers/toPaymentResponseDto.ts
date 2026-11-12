import { Payment } from '../../domain/entities/Payment';
import { PaymentResponseDto } from '../dto/response/PaymentResponseDto';

/**
 * Arma la respuesta de un pago con sus datos de pasarela
 * @description `provider` sale siempre, también en un pago manual, para que
 * quien consume la API sepa qué tipo de pago es sin deducirlo de los campos que
 * faltan. Los datos de pasarela sin valor quedan sin definir y no aparecen en
 * la respuesta. El vencimiento del checkout es el efectivo, el mismo que usa la
 * regla de cobro único, y se informa solo cuando el pago tiene un checkout
 * creado. Nunca se expone `idempotencyKey`: es una credencial de deduplicación.
 * @param payment - Pago a convertir
 * @returns La respuesta del pago
 */
export function toPaymentResponseDto(payment: Payment): PaymentResponseDto {
  return {
    id: payment.id,
    amount: payment.amount,
    status: payment.status,
    method: payment.method,
    paymentDate: payment.paymentDate,
    appointmentId: payment.appointmentId,
    refundReason: payment.refundReason,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    provider: payment.provider,
    gatewayPaymentId: payment.gatewayPaymentId,
    gatewayStatus: payment.gatewayStatus,
    refundedAmount: payment.refundedAmount,
    gatewayRefundId: payment.gatewayRefundId,
    failureReason: payment.failureReason,
    lastSyncedAt: payment.lastSyncedAt,
    checkoutUrl: payment.checkoutUrl,
    checkoutExpiresAt: payment.checkoutUrl ? payment.effectiveCheckoutExpiresAt : undefined,
  };
}
