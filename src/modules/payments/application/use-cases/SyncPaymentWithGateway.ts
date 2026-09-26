import { Payment } from '../../domain/entities/Payment';
import { IPaymentRepository } from '../../domain/repositories/IPaymentRepository';
import { PaymentStatusMapper } from '../../domain/services/PaymentStatusMapper';
import { IPaymentGateway, GatewayPaymentSnapshot } from '../../domain/gateways/IPaymentGateway';
import { PaymentResponseDto } from '../dto/response/PaymentResponseDto';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../shared/exceptions/BusinessRuleError';
import { AppError } from '../../../../shared/exceptions/AppError';
import { logger } from '../../../../shared/logger/logger';

/**
 * Resultado de sincronizar un pago contra la pasarela
 */
export interface SyncPaymentResult {
  /** El pago tal como quedó después de aplicar el estado del proveedor */
  payment: PaymentResponseDto;
  /**
   * Si la sincronización movió el estado del pago
   * @description `false` tanto cuando el pago ya estaba al día como cuando el
   * proveedor informó una transición imposible: en los dos casos el estado
   * local quedó igual, que es lo único que le importa a quien reconcilia.
   */
  changed: boolean;
}

/**
 * Caso de uso para reconciliar un pago contra la pasarela a pedido
 * @description Es el mismo flujo que dispara una notificación de la pasarela
 * -- releer el estado autoritativo, traducirlo y aplicarlo -- pero disparado a
 * mano por un operador. Existe porque las notificaciones se pierden: si una no
 * llega, o llega y falla, el pago queda desfasado del proveedor sin que nada
 * lo corrija solo.
 *
 * A diferencia del camino automático, este no registra ningún evento de
 * pasarela: esa tabla modela notificaciones del proveedor, identificadas por
 * un id que el proveedor asigna, y una sincronización manual no tiene ninguno.
 * Inventar uno sintético contaminaría la deduplicación del webhook. La
 * trazabilidad sale del log y de `lastSyncedAt`, que se refresca siempre.
 *
 * Solo ADMIN, y la restricción se aplica en la ruta: no hay ownership que
 * chequear porque ningún otro rol llega hasta acá.
 */
export class SyncPaymentWithGateway {
  constructor(
    private paymentRepository: IPaymentRepository,
    private paymentGateway: IPaymentGateway,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param paymentId - ID del pago local a sincronizar
   * @returns El pago actualizado y si la sincronización movió su estado
   * @throws NotFoundError si el pago no existe
   * @throws BusinessRuleError si el pago no es de pasarela, si todavía no
   * tiene identificador en el proveedor, o si el proveedor no lo reconoce
   * @throws AppError con status 502 si la pasarela no responde
   */
  async execute(paymentId: string): Promise<SyncPaymentResult> {
    const payment = await this.paymentRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundError('Payment', paymentId);
    }

    if (!payment.isGatewayBacked) {
      throw new BusinessRuleError(
        'Only gateway-backed payments can be synced: a manual payment has no state at any provider to read',
      );
    }

    if (!payment.gatewayPaymentId) {
      // Distinto de "no cambió nada": no se llegó a consultar. Pasa mientras
      // la intención de cobro está abierta y nadie la pagó todavía, así que no
      // hay un pago del lado del proveedor al que apuntar.
      throw new BusinessRuleError(
        'This payment has no gateway payment identifier yet: the checkout is still open and nobody has paid it, so there is nothing to read from the provider',
      );
    }

    const snapshot = await this.fetchSnapshot(payment.gatewayPaymentId);

    const internalStatus = PaymentStatusMapper.toInternalStatus(snapshot.status);
    const transition = payment.applyGatewayStatus({
      status: internalStatus,
      gatewayStatus: snapshot.status,
      gatewayPaymentId: snapshot.gatewayPaymentId,
      failureReason: snapshot.statusDetail,
      refundedAmount: snapshot.refundedAmount,
    });

    // Se persiste en los tres desenlaces, no solo cuando el estado se movió:
    // `applyGatewayStatus` refresca el estado crudo del proveedor y
    // `lastSyncedAt` siempre, y dejar constancia de que se consultó es la
    // mitad del valor de este endpoint.
    const updatedPayment = await this.paymentRepository.update(payment);

    if (transition === 'conflict') {
      logger.warn('[SyncPaymentWithGateway] transición imposible, el pago no se movió', {
        paymentId: payment.id,
        currentStatus: payment.status,
        gatewayStatus: snapshot.status,
      });
    } else {
      logger.info('[SyncPaymentWithGateway] pago sincronizado', {
        paymentId: payment.id,
        gatewayStatus: snapshot.status,
        transition,
      });
    }

    return {
      payment: this.toResponseDto(updatedPayment),
      changed: transition === 'applied',
    };
  }

  /**
   * Relee el estado autoritativo del pago desde la pasarela
   * @param gatewayPaymentId - Identificador del pago en la pasarela
   * @returns El snapshot informado por el proveedor
   * @throws BusinessRuleError si el proveedor no reconoce el identificador
   * @throws AppError con status 502 si la pasarela no responde, o la excepción
   * original si el fallo es de configuración de este lado
   */
  private async fetchSnapshot(gatewayPaymentId: string): Promise<GatewayPaymentSnapshot> {
    let snapshot: GatewayPaymentSnapshot | null;

    try {
      snapshot = await this.paymentGateway.getPayment(gatewayPaymentId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown gateway error';
      logger.error('[SyncPaymentWithGateway] la pasarela no respondió al releer el pago', {
        gatewayPaymentId,
        reason,
      });

      // Sin pasarela configurada el fallo es de este servidor, no del
      // proveedor externo, así que la excepción se repropaga tal cual en vez
      // de disfrazarse de 502. Mismo criterio que el resto del módulo.
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'The payment gateway did not respond. Please try again later.',
        502,
        'BUSINESS_RULE_ERROR',
      );
    }

    if (!snapshot) {
      // El proveedor no conoce ese identificador con nuestras credenciales.
      // Reintentar no lo va a hacer aparecer, así que no es un 502.
      throw new BusinessRuleError(
        `The payment gateway does not recognize payment ${gatewayPaymentId}`,
      );
    }

    return snapshot;
  }

  private toResponseDto(payment: Payment): PaymentResponseDto {
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
    };
  }
}
