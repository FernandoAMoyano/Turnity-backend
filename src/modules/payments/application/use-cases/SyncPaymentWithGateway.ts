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
 * El identificador del pago en la pasarela solo lo escribe el webhook. Si la
 * notificación nunca llegó, el pago local no lo tiene, así que se busca en la
 * pasarela por la referencia externa enviada al crear el checkout (el
 * `Payment.id`). Ese es justamente el caso para el que existe este endpoint.
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
   * @throws BusinessRuleError si el pago no es de pasarela, si no tiene
   * identificador en el proveedor y el proveedor tampoco tiene ningún pago con
   * su referencia externa, o si el proveedor no reconoce el identificador
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

    const snapshot = payment.gatewayPaymentId
      ? await this.fetchSnapshot(payment.gatewayPaymentId)
      : await this.findSnapshotByReference(payment.id);

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
    const snapshot = await this.callGateway(
      () => this.paymentGateway.getPayment(gatewayPaymentId),
      { gatewayPaymentId },
    );

    if (!snapshot) {
      // El proveedor no conoce ese identificador con nuestras credenciales.
      // Reintentar no lo va a hacer aparecer, así que no es un 502.
      throw new BusinessRuleError(
        `The payment gateway does not recognize payment ${gatewayPaymentId}`,
      );
    }

    return snapshot;
  }

  /**
   * Busca en la pasarela el pago de un checkout cuya notificación no llegó
   * @param paymentId - ID del pago local, enviado como referencia externa al
   * crear el checkout
   * @returns El snapshot del pago que la pasarela tiene para esa referencia
   * @throws BusinessRuleError si la pasarela no tiene ningún pago con esa
   * referencia
   * @throws AppError con status 502 si la pasarela no responde, o la excepción
   * original si el fallo es de configuración de este lado
   */
  private async findSnapshotByReference(paymentId: string): Promise<GatewayPaymentSnapshot> {
    const snapshot = await this.callGateway(
      () => this.paymentGateway.findPaymentByExternalReference(paymentId),
      { paymentId },
    );

    if (!snapshot) {
      // Sin pago en el proveedor no hay estado que traer: el checkout sigue
      // abierto, o venció sin que nadie lo pagara. Reintentar no lo cambia.
      throw new BusinessRuleError(
        'This payment has no gateway payment identifier and the payment gateway has no payment for its checkout: nobody has paid it, so there is nothing to sync',
      );
    }

    return snapshot;
  }

  /**
   * Ejecuta una consulta a la pasarela y traduce sus fallos
   * @param operation - Consulta a ejecutar
   * @param logContext - Identificadores que se registran si la consulta falla
   * @returns Lo que devuelve la consulta
   * @throws AppError con status 502 si la pasarela no responde, o la excepción
   * original si ya es un `AppError`
   */
  private async callGateway<T>(
    operation: () => Promise<T>,
    logContext: Record<string, string>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown gateway error';
      logger.error('[SyncPaymentWithGateway] la pasarela no respondió al consultar el pago', {
        ...logContext,
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
