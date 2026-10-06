import { Payment } from '../../domain/entities/Payment';
import { IPaymentRepository } from '../../domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../appointments/domain/repositories/IAppointmentRepository';
import { PaymentResponseDto } from '../dto/response/PaymentResponseDto';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';

/**
 * Caso de uso para cancelar (marcar como fallido) un pago
 * @description Marca un pago pendiente como fallido. Aplica control de acceso
 * por ownership: ADMIN sin restricción, STYLIST solo si es el estilista
 * asignado a la cita del pago; CLIENT no tiene acceso a esta operación (fuera
 * del alcance aprobado, ver F18)
 */
export class CancelPayment {
  constructor(
    private paymentRepository: IPaymentRepository,
    private appointmentRepository: IAppointmentRepository,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param paymentId - ID del pago a cancelar
   * @param requesterId - ID del usuario que realiza la operación
   * @param requesterRole - Nombre del rol del usuario solicitante
   * @returns El pago cancelado
   * @throws NotFoundError si el pago no existe, o si la cita asociada no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   * @throws BusinessRuleError si el pago no puede ser cancelado
   */
  async execute(
    paymentId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundError('Payment', paymentId);
    }

    await this.validateAccessPermissions(payment.appointmentId, requesterId, requesterRole);

    // Antes del chequeo de estado a propósito: darle de baja localmente a un
    // checkout que sigue abierto en la pasarela dejaría el pago como fallido
    // acá mientras el pagador todavía puede completarlo allá. Cancelar de
    // verdad exige cancelar también la intención de cobro en el proveedor, y
    // eso está fuera del alcance de esta versión.
    if (payment.isGatewayBacked) {
      throw new BusinessRuleError(
        'Gateway-backed payments cannot be cancelled manually: the checkout is still open at the payment gateway',
      );
    }

    if (!payment.isPending) {
      throw new BusinessRuleError('Only pending payments can be cancelled');
    }

    // Marcar como fallido
    payment.markAsFailed();

    // Guardar cambios
    const updatedPayment = await this.paymentRepository.update(payment);

    return this.toResponseDto(updatedPayment);
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
    // ADMIN puede cancelar cualquier pago
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
    };
  }
}
