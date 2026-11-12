import { IPaymentRepository } from '../../domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../appointments/domain/repositories/IAppointmentRepository';
import { PaymentResponseDto } from '../dto/response/PaymentResponseDto';
import { toPaymentResponseDto } from '../mappers/toPaymentResponseDto';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';

/**
 * Caso de uso para obtener un pago por ID
 * @description Busca y retorna un pago específico, aplicando control de acceso
 * por ownership sobre la cita asociada: ADMIN sin restricción, STYLIST solo
 * pagos de citas donde es el estilista asignado. CLIENT nunca llega a este use
 * case: `GET /payments/:id` solo permite ADMIN/STYLIST a nivel de ruta; el
 * CLIENT accede a sus pagos únicamente vía `GET /payments/appointment/:id` (F18)
 */
export class GetPaymentById {
  constructor(
    private paymentRepository: IPaymentRepository,
    private appointmentRepository: IAppointmentRepository,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param id - ID del pago a buscar
   * @param requesterId - ID del usuario que realiza la consulta
   * @param requesterRole - Nombre del rol del usuario solicitante
   * @returns El pago encontrado
   * @throws NotFoundError si el pago no existe, o si la cita asociada no
   * existe (solo se resuelve para STYLIST, ver validateAccessPermissions)
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   */
  async execute(
    id: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentRepository.findById(id);

    if (!payment) {
      throw new NotFoundError('Payment', id);
    }

    await this.validateAccessPermissions(payment.appointmentId, requesterId, requesterRole);

    return toPaymentResponseDto(payment);
  }

  /**
   * Valida que el usuario tenga permisos sobre la cita asociada al pago
   * @param appointmentId - ID de la cita asociada al pago
   * @param requesterId - ID del usuario solicitante
   * @param requesterRole - Nombre del rol del usuario
   * @throws NotFoundError si la cita asociada no existe
   * @throws ForbiddenError si no tiene permisos
   */
  private async validateAccessPermissions(
    appointmentId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<void> {
    // ADMIN puede ver cualquier pago
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

    // CLIENT (y cualquier otro rol): bloqueado sin resolver la cita. En la
    // práctica CLIENT nunca llega aquí porque `GET /payments/:id` solo autoriza
    // ADMIN/STYLIST en la ruta; el CLIENT accede a sus pagos vía
    // `GET /payments/appointment/:id` (F18), donde sí se valida su ownership.
    throw new ForbiddenError('You can only access payments for your own appointments');
  }
}
