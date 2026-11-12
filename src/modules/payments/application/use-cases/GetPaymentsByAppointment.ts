import { IPaymentRepository } from '../../domain/repositories/IPaymentRepository';
import { IAppointmentRepository } from '../../../appointments/domain/repositories/IAppointmentRepository';
import { PaymentResponseDto } from '../dto/response/PaymentResponseDto';
import { toPaymentResponseDto } from '../mappers/toPaymentResponseDto';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';

/**
 * Caso de uso para obtener pagos por cita
 * @description Busca todos los pagos asociados a una cita específica, aplicando
 * control de acceso por ownership: ADMIN sin restricción, STYLIST solo si es el
 * estilista asignado a la cita, CLIENT solo si es el cliente o el creador.
 */
export class GetPaymentsByAppointment {
  constructor(
    private paymentRepository: IPaymentRepository,
    private appointmentRepository: IAppointmentRepository,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param appointmentId - ID de la cita
   * @param requesterId - ID del usuario que realiza la consulta
   * @param requesterRole - Nombre del rol del usuario solicitante
   * @returns Lista de pagos de la cita
   * @throws NotFoundError si la cita no existe (solo se resuelve para
   * STYLIST/CLIENT, ver validateAccessPermissions)
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita
   */
  async execute(
    appointmentId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<PaymentResponseDto[]> {
    await this.validateAccessPermissions(appointmentId, requesterId, requesterRole);

    const payments = await this.paymentRepository.findByAppointmentId(appointmentId);

    return payments.map((payment) => toPaymentResponseDto(payment));
  }

  /**
   * Valida que el usuario tenga permisos sobre la cita consultada
   * @param appointmentId - ID de la cita
   * @param requesterId - ID del usuario solicitante
   * @param requesterRole - Nombre del rol del usuario
   * @throws NotFoundError si la cita no existe
   * @throws ForbiddenError si no tiene permisos
   */
  private async validateAccessPermissions(
    appointmentId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<void> {
    // ADMIN puede ver pagos de cualquier cita
    if (requesterRole === 'ADMIN') return;

    if (requesterRole === 'STYLIST' || requesterRole === 'CLIENT') {
      const appointment = await this.appointmentRepository.findById(appointmentId);
      if (!appointment) {
        throw new NotFoundError('Appointment', appointmentId);
      }

      if (requesterRole === 'STYLIST') {
        if (appointment.stylistId !== requesterId) {
          throw new ForbiddenError('You can only access payments for your own appointments');
        }
        return;
      }

      // CLIENT: dueño de la cita (cliente o creador)
      if (appointment.clientId !== requesterId && appointment.userId !== requesterId) {
        throw new ForbiddenError('You can only access payments for your own appointments');
      }
      return;
    }

    throw new ForbiddenError('You can only access payments for your own appointments');
  }
}
