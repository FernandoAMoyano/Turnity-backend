import { Payment } from '../../domain/entities/Payment';
import { IPaymentRepository } from '../../domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../appointments/domain/repositories/IAppointmentRepository';
import { ProcessPaymentDto } from '../dto/request/ProcessPaymentDto';
import { PaymentResponseDto } from '../dto/response/PaymentResponseDto';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';
import { AppointmentChargeGuard, ChargeConflictMessages } from '../services/AppointmentChargeGuard';

/**
 * Mensajes con los que se rechaza procesar un pago manual sobre una cita que
 * no puede cobrarse
 */
const PROCESS_PAYMENT_CONFLICT_MESSAGES: ChargeConflictMessages = {
  alreadyPaid:
    'This appointment already has a completed payment. This payment cannot be processed.',
  openCheckout:
    'There is a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it, before processing a manual payment.',
};

/**
 * Caso de uso para procesar (completar) un pago manual
 * @description Marca un pago como completado con el método de pago utilizado.
 * Aplica control de acceso por ownership: ADMIN sin restricción, STYLIST solo
 * si es el estilista asignado a la cita del pago; CLIENT no tiene acceso a
 * esta operación.
 *
 * Una cita se cobra una sola vez: el pago no se completa si la cita ya tiene
 * otro pago completado, manual o de pasarela, ni si tiene un checkout de
 * pasarela abierto. La regla se revisa acá aunque ya se haya revisado al crear
 * el pago, porque entre la creación y el procesamiento el cliente pudo haber
 * pagado online.
 */
export class ProcessPayment {
  constructor(
    private paymentRepository: IPaymentRepository,
    private appointmentRepository: IAppointmentRepository,
    private chargeGuard: AppointmentChargeGuard,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param dto - Datos para procesar el pago
   * @param requesterId - ID del usuario que realiza la operación
   * @param requesterRole - Nombre del rol del usuario solicitante
   * @returns El pago procesado
   * @throws NotFoundError si el pago no existe, o si la cita asociada no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   * @throws BusinessRuleError si el pago no puede ser procesado
   * @throws ConflictError si la cita ya está pagada o tiene un checkout abierto
   * @throws AppError con status 502 si la pasarela falla al revisar un checkout vencido
   */
  async execute(
    dto: ProcessPaymentDto,
    requesterId: string,
    requesterRole: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentRepository.findById(dto.paymentId);

    if (!payment) {
      throw new NotFoundError('Payment', dto.paymentId);
    }

    await this.validateAccessPermissions(payment.appointmentId, requesterId, requesterRole);

    // Antes del chequeo de estado a propósito: un pago respaldado por una
    // pasarela no se completa a mano en ningún estado. Si esta guarda fuera
    // después, un pago de pasarela pendiente se marcaría como cobrado sin que
    // el dinero haya entrado, y uno ya resuelto respondería "solo se pueden
    // procesar pagos pendientes", que es un motivo falso.
    if (payment.isGatewayBacked) {
      throw new BusinessRuleError(
        'Gateway-backed payments are completed by the payment gateway, not manually',
      );
    }

    if (!payment.isPending) {
      throw new BusinessRuleError('Only pending payments can be processed');
    }

    // Después del chequeo de estado: un pago ya completado que se intenta
    // procesar de nuevo responde "solo se pueden procesar pagos pendientes",
    // no un conflicto de cobro.
    await this.chargeGuard.ensureAppointmentIsChargeable(
      payment.appointmentId,
      PROCESS_PAYMENT_CONFLICT_MESSAGES,
    );

    // Marcar como completado
    payment.markAsCompleted(dto.method);

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
    // ADMIN puede procesar cualquier pago
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
