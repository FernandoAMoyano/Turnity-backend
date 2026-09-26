import { Payment, PaymentStatusEnum } from '../../domain/entities/Payment';
import { IPaymentRepository } from '../../domain/repositories/IPaymentRepository';
import { IPaymentGateway, GatewayRefund } from '../../domain/gateways/IPaymentGateway';
import { IAppointmentRepository } from '../../../appointments/domain/repositories/IAppointmentRepository';
import { RefundPaymentDto } from '../dto/request/RefundPaymentDto';
import { PaymentResponseDto } from '../dto/response/PaymentResponseDto';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';
import { AppError } from '../../../../shared/exceptions/AppError';
import { logger } from '../../../../shared/logger/logger';

/**
 * Estado crudo con el que la pasarela informa un pago ya reembolsado
 * @description Se persiste en `gatewayStatus` cuando el reembolso se confirma
 * en el acto, para que ese campo diga lo mismo que va a decir la notificación
 * de la pasarela cuando llegue por el camino automático. Sin esto, el mismo
 * pago mostraría un estado crudo distinto según quién lo hubiera resuelto.
 */
const GATEWAY_REFUNDED_STATUS = 'refunded';

/**
 * Caso de uso para reembolsar un pago
 * @description Dos caminos según cómo se haya cobrado el pago. El manual marca
 * el pago como reembolsado y termina ahí: no hay a quién pedirle el dinero de
 * vuelta, porque lo devuelve el salón. El respaldado por pasarela ejecuta el
 * reembolso contra el proveedor y solo mueve el estado local si el proveedor
 * lo confirma; marcar REFUNDED antes de eso sería declarar devuelto un dinero
 * que todavía no salió.
 *
 * Aplica control de acceso por ownership en los dos caminos: ADMIN sin
 * restricción, STYLIST solo si es el estilista asignado a la cita del pago;
 * CLIENT no tiene acceso a esta operación (fuera del alcance aprobado, ver
 * F18).
 */
export class RefundPayment {
  constructor(
    private paymentRepository: IPaymentRepository,
    private appointmentRepository: IAppointmentRepository,
    private paymentGateway: IPaymentGateway,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param dto - Datos para reembolsar el pago
   * @param requesterId - ID del usuario que realiza la operación
   * @param requesterRole - Nombre del rol del usuario solicitante
   * @returns El pago: reembolsado si la operación se completó, o todavía
   * completado si la pasarela dejó el reembolso en curso. El controller
   * distingue los dos casos por el estado resultante para elegir entre 200 y
   * 202.
   * @throws NotFoundError si el pago no existe, o si la cita asociada no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   * @throws BusinessRuleError si el pago no puede ser reembolsado, o si es de
   * pasarela y todavía no tiene identificador en el proveedor
   * @throws AppError con status 502 si la pasarela falla o rechaza el reembolso
   */
  async execute(
    dto: RefundPaymentDto,
    requesterId: string,
    requesterRole: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentRepository.findById(dto.paymentId);

    if (!payment) {
      throw new NotFoundError('Payment', dto.paymentId);
    }

    await this.validateAccessPermissions(payment.appointmentId, requesterId, requesterRole);

    // Vale para los dos caminos: no se devuelve un dinero que nunca entró.
    if (!payment.isCompleted) {
      throw new BusinessRuleError('Only completed payments can be refunded');
    }

    if (payment.isGatewayBacked) {
      return this.refundThroughGateway(payment, dto.reason);
    }

    // Marcar como reembolsado con razón opcional
    payment.refund(dto.reason);

    // Guardar cambios
    const updatedPayment = await this.paymentRepository.update(payment);

    return this.toResponseDto(updatedPayment);
  }

  /**
   * Ejecuta el reembolso contra la pasarela y aplica el desenlace
   * @description Tres desenlaces posibles y solo uno mueve el estado del pago.
   * Confirmado: pasa a REFUNDED. En curso: el pago sigue COMPLETED y se anotan
   * los identificadores del reembolso, a la espera de que lo confirme una
   * notificación de la pasarela o una sincronización manual. Rechazado: no se
   * anota nada, porque no hay nada que esperar.
   * @param payment - Pago a reembolsar, ya validado como completado
   * @param reason - Motivo declarado por quien ordenó el reembolso
   * @returns El pago con el desenlace ya persistido
   */
  private async refundThroughGateway(
    payment: Payment,
    reason?: string,
  ): Promise<PaymentResponseDto> {
    if (!payment.gatewayPaymentId) {
      // Un pago de pasarela completado sin identificador en el proveedor es un
      // dato inconsistente: algo lo completó sin pasar por el camino
      // automático. Sincronizarlo contra el proveedor es lo que puede
      // recuperar ese identificador.
      throw new BusinessRuleError(
        'This payment has no gateway payment identifier, so there is nothing to refund at the payment gateway. Sync it with the provider first',
      );
    }

    const refund = await this.requestRefund(payment);

    if (refund.status === 'rejected') {
      logger.warn('[RefundPayment] la pasarela rechazó el reembolso', {
        paymentId: payment.id,
        gatewayPaymentId: payment.gatewayPaymentId,
        gatewayRefundId: refund.gatewayRefundId,
      });
      // No se persiste nada: un reembolso rechazado no deja rastro en el pago,
      // que sigue cobrado y sigue siendo reembolsable en un intento posterior.
      throw new AppError(
        'The payment gateway refused the refund. Check the payment at the provider before retrying.',
        502,
        'BUSINESS_RULE_ERROR',
      );
    }

    if (refund.status === 'pending') {
      logger.info('[RefundPayment] reembolso en curso, el pago todavía no cambia de estado', {
        paymentId: payment.id,
        gatewayRefundId: refund.gatewayRefundId,
      });
      payment.recordRefundRequested(refund.gatewayRefundId, refund.amount, reason);
    } else {
      payment.applyGatewayStatus({
        status: PaymentStatusEnum.REFUNDED,
        gatewayStatus: GATEWAY_REFUNDED_STATUS,
        gatewayRefundId: refund.gatewayRefundId,
        refundedAmount: refund.amount,
        refundReason: reason,
      });
    }

    const updatedPayment = await this.paymentRepository.update(payment);

    return this.toResponseDto(updatedPayment);
  }

  /**
   * Pide el reembolso a la pasarela y traduce sus fallos al contrato de la API
   * @description La clave de idempotencia se deriva del id del pago en vez de
   * generarse al azar: tiene que ser la misma ante un reintento, que es
   * justamente lo que evita el doble reembolso. No se reutiliza la
   * `idempotencyKey` del pago, que identifica la creación del cobro y no su
   * devolución.
   * @param payment - Pago a reembolsar, con identificador en la pasarela ya verificado
   * @returns El resultado que informó la pasarela
   * @throws AppError con status 502 si la pasarela falla, o la excepción
   * original si el fallo es de configuración de este lado
   */
  private async requestRefund(payment: Payment): Promise<GatewayRefund> {
    const idempotencyKey = `refund-${payment.id}`;

    try {
      return await this.paymentGateway.refund(payment.gatewayPaymentId!, idempotencyKey);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown gateway error';
      logger.error('[RefundPayment] la pasarela falló al ejecutar el reembolso', {
        paymentId: payment.id,
        gatewayPaymentId: payment.gatewayPaymentId,
        reason,
      });

      // Sin pasarela configurada, NoopPaymentGateway lanza BusinessRuleError
      // (422): es un error de configuración de este servidor, no un fallo del
      // proveedor externo, así que se repropaga tal cual en vez de disfrazarse
      // de 502.
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'The payment gateway did not process the refund. Please try again later.',
        502,
        'BUSINESS_RULE_ERROR',
      );
    }
  }

  /**
   * Valida que el usuario tenga permisos para operar sobre el pago, a partir
   * de la cita asociada. CLIENT no tiene acceso a esta operación bajo ninguna
   * circunstancia (solo lectura, fuera del alcance aprobado)
   * @throws NotFoundError si la cita asociada no existe
   * @throws ForbiddenError si no tiene permisos
   */
  private async validateAccessPermissions(
    appointmentId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<void> {
    // ADMIN puede reembolsar cualquier pago
    if (requesterRole === 'ADMIN') return;

    if (requesterRole === 'STYLIST') {
      const appointment = await this.appointmentRepository.findById(appointmentId);
      if (!appointment) {
        throw new NotFoundError('Appointment', appointmentId);
      }

      if (appointment.stylistId !== requesterId) {
        throw new ForbiddenError('You can only access payments for your own appointments');
      }
      return;
    }

    // CLIENT y cualquier otro rol: sin acceso a esta operación
    throw new ForbiddenError('You can only access payments for your own appointments');
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
      lastSyncedAt: payment.lastSyncedAt,
    };
  }
}
