import { Payment } from '../../domain/entities/Payment';
import { IPaymentRepository } from '../../domain/repositories/IPaymentRepository';
import { IPaymentGateway, GatewayPaymentSnapshot } from '../../domain/gateways/IPaymentGateway';
import { PaymentStatusMapper } from '../../domain/services/PaymentStatusMapper';
import { translateGatewayFailure } from '../errors/translateGatewayFailure';
import { ConflictError } from '../../../../shared/exceptions/ConflictError';
import { logger } from '../../../../shared/logger/logger';

/**
 * Motivo con el que se cierra un checkout que venció sin pago en la pasarela
 */
const EXPIRED_CHECKOUT_REASON = 'Checkout expired without a payment at the payment gateway';

/**
 * Mensajes de conflicto que cada caso de uso devuelve al rechazar un cobro
 * @description La regla es la misma para el checkout y para el pago manual,
 * pero el mensaje describe la operación que se rechazó.
 */
export interface ChargeConflictMessages {
  /** Mensaje cuando la cita ya tiene un pago completado */
  alreadyPaid: string;
  /** Mensaje cuando la cita tiene un checkout de pasarela abierto */
  openCheckout: string;
}

/**
 * Servicio de aplicación que hace cumplir el cobro único de una cita
 * @description Una cita se cobra una sola vez, sea por checkout de pasarela o
 * por pago manual. La cita no puede cobrarse si ya tiene un pago completado,
 * manual o de pasarela, ni si tiene un checkout de pasarela abierto. Un pago
 * reembolsado o fallido no bloquea. Un checkout vencido deja de bloquear
 * recién después de confirmar con la pasarela que nadie lo pagó.
 */
export class AppointmentChargeGuard {
  constructor(
    private paymentRepository: IPaymentRepository,
    private paymentGateway: IPaymentGateway,
  ) {}

  /**
   * Verifica que la cita no esté pagada ni tenga un checkout abierto
   * @description Revisa contra la pasarela los checkouts vencidos y deja sus
   * pagos locales al día antes de decidir.
   * @param appointmentId - ID de la cita a cobrar
   * @param messages - Mensajes de conflicto de la operación que se intenta
   * @throws ConflictError si la cita ya está pagada o tiene un checkout abierto
   * @throws AppError con status 502 si la pasarela falla al revisar un checkout vencido
   */
  async ensureAppointmentIsChargeable(
    appointmentId: string,
    messages: ChargeConflictMessages,
  ): Promise<void> {
    const paymentsForAppointment = await this.paymentRepository.findByAppointmentId(appointmentId);

    if (paymentsForAppointment.some((payment) => payment.isCompleted)) {
      throw new ConflictError(messages.alreadyPaid);
    }

    const openCheckouts = paymentsForAppointment.filter(
      (payment) => payment.isGatewayBacked && payment.isPending,
    );

    for (const openCheckout of openCheckouts) {
      if (!openCheckout.hasCheckoutExpired()) {
        throw new ConflictError(messages.openCheckout);
      }

      await this.closeExpiredCheckout(openCheckout);

      if (openCheckout.isCompleted) {
        throw new ConflictError(messages.alreadyPaid);
      }
      if (openCheckout.isPending) {
        throw new ConflictError(messages.openCheckout);
      }
    }
  }

  /**
   * Revisa contra la pasarela un checkout vencido y deja el pago local al día
   * @description Que la preferencia haya vencido no garantiza que nadie la
   * haya pagado: un pago enviado a último momento, o uno que quedó en proceso,
   * puede existir del lado de la pasarela sin que haya llegado la
   * notificación. Si la pasarela tiene un pago para este checkout, se aplica
   * su estado. Si no tiene ninguno, el pago local se marca FAILED. Si después
   * llega una aprobación tardía, el webhook todavía puede pasarlo a COMPLETED.
   * @param payment - Pago de pasarela PENDING con el checkout vencido
   * @throws AppError con status 502 si la pasarela falla
   */
  private async closeExpiredCheckout(payment: Payment): Promise<void> {
    let snapshot: GatewayPaymentSnapshot | null;
    try {
      snapshot = payment.gatewayPaymentId
        ? await this.paymentGateway.getPayment(payment.gatewayPaymentId)
        : await this.paymentGateway.findPaymentByExternalReference(payment.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown gateway error';
      logger.error('[AppointmentChargeGuard] La pasarela falló al revisar un checkout vencido', {
        paymentId: payment.id,
        reason,
      });

      throw translateGatewayFailure(error, {
        retryable:
          'The payment gateway did not respond while checking an expired checkout for this appointment. Please try again later.',
        rejected:
          'The payment gateway rejected the request to check an expired checkout for this appointment.',
      });
    }

    if (snapshot) {
      payment.applyGatewayStatus({
        status: PaymentStatusMapper.toInternalStatus(snapshot.status),
        gatewayStatus: snapshot.status,
        gatewayPaymentId: snapshot.gatewayPaymentId,
        failureReason: snapshot.statusDetail,
        refundedAmount: snapshot.refundedAmount,
      });
    } else {
      payment.markAsFailed(EXPIRED_CHECKOUT_REASON);
    }

    await this.paymentRepository.update(payment);

    logger.info('[AppointmentChargeGuard] Checkout vencido revisado contra la pasarela', {
      paymentId: payment.id,
      gatewayStatus: snapshot?.status,
      status: payment.status,
    });
  }
}
