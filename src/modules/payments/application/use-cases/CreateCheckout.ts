import { generateUuid } from '../../../../shared/utils/uuid';
import { centsToAmount } from '../../../../shared/utils/money';
import { Payment, PaymentProviderEnum } from '../../domain/entities/Payment';
import { IGatewayAwarePaymentRepository } from '../../domain/repositories/IPaymentGatewayLookup';
import { IPaymentGateway } from '../../domain/gateways/IPaymentGateway';
import { AppointmentPriceCalculator } from '../../domain/services/AppointmentPriceCalculator';
import { Appointment } from '../../../appointments/domain/entities/Appointment';
import { IAppointmentRepository } from '../../../appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../appointments/domain/repositories/IAppointmentStatusRepository';
import { Service } from '../../../services/domain/entities/Service';
import { IServiceRepository } from '../../../services/domain/repositories/IServiceRepository';
import { IStylistServiceRepository } from '../../../services/domain/repositories/IStylistServiceRepository';
import { CreateCheckoutDto } from '../dto/request/CreateCheckoutDto';
import { CheckoutResponseDto } from '../dto/response/CheckoutResponseDto';
import { translateGatewayFailure } from '../errors/translateGatewayFailure';
import { AppointmentChargeGuard, ChargeConflictMessages } from '../services/AppointmentChargeGuard';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';
import { logger } from '../../../../shared/logger/logger';

/**
 * Mensajes con los que se rechaza abrir un checkout sobre una cita que no
 * puede cobrarse
 */
const CHECKOUT_CONFLICT_MESSAGES: ChargeConflictMessages = {
  alreadyPaid: 'This appointment already has a completed payment. A new checkout cannot be opened.',
  openCheckout:
    'There is already a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it.',
};

/**
 * Caso de uso para abrir un checkout contra la pasarela de pago
 * @description Crea (o reutiliza, ante un reintento con la misma
 * `Idempotency-Key`) un `Payment` PENDING respaldado por la pasarela, y
 * devuelve la URL de checkout hospedado a la que redirigir al pagador.
 *
 * El monto lo calcula el servidor a partir de los servicios de la cita, al
 * precio del estilista asignado si tiene uno propio. Nunca sale del pedido.
 *
 * Una cita se cobra una sola vez: no se abre un checkout si la cita ya tiene un
 * pago completado, manual o de pasarela, ni si tiene otro checkout de pasarela
 * abierto. Un checkout vencido deja de bloquear recién después de confirmar
 * con la pasarela que nadie lo pagó.
 *
 * Permisos: ADMIN sin restricción, STYLIST solo si es el estilista asignado y
 * CLIENT solo si es el dueño de la cita. Es la única operación de escritura
 * sobre pagos que se le permite a CLIENT.
 */
export class CreateCheckout {
  constructor(
    private paymentRepository: IGatewayAwarePaymentRepository,
    private appointmentRepository: IAppointmentRepository,
    private appointmentStatusRepository: IAppointmentStatusRepository,
    private paymentGateway: IPaymentGateway,
    private serviceRepository: IServiceRepository,
    private stylistServiceRepository: IStylistServiceRepository,
    private chargeGuard: AppointmentChargeGuard,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param dto - Datos para crear el checkout
   * @param requesterId - ID del usuario que realiza la operación
   * @param requesterRole - Nombre del rol del usuario solicitante
   * @returns El checkout creado (o el ya existente, si `idempotencyKey`
   * coincide con uno anterior) más un flag `created` que el controller usa
   * para elegir 201 vs 200
   * @throws NotFoundError si la cita o alguno de sus servicios no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita
   * @throws BusinessRuleError si la cita no está en un estado válido para
   * pagar o no tiene servicios que cobrar
   * @throws ConflictError si la cita ya está pagada o ya tiene un checkout abierto
   * @throws AppError con status 502 si la pasarela falla
   */
  async execute(
    dto: CreateCheckoutDto,
    requesterId: string,
    requesterRole: string,
  ): Promise<{ dto: CheckoutResponseDto; created: boolean }> {
    const appointment = await this.appointmentRepository.findById(dto.appointmentId);
    if (!appointment) {
      throw new NotFoundError('Appointment', dto.appointmentId);
    }

    this.validateAccessPermissions(appointment, requesterId, requesterRole);

    const status = await this.appointmentStatusRepository.findById(appointment.statusId);
    const allowedStatuses = ['CONFIRMED', 'COMPLETED'];
    if (!status || !allowedStatuses.includes(status.name)) {
      throw new BusinessRuleError(
        `Cannot create a checkout for an appointment with status ${status?.name || 'UNKNOWN'}. Appointment must be confirmed or completed`,
      );
    }

    // Idempotencia saliente: un reintento del cliente con la misma clave
    // devuelve el checkout ya creado en vez de abrir una segunda preferencia
    // en la pasarela. Complementa los chequeos de cobro único, que evitan un
    // segundo checkout por dos acciones distintas del usuario.
    let payment: Payment;
    const description = dto.description ?? `Payment for appointment ${appointment.id}`;

    if (dto.idempotencyKey) {
      const existing = await this.paymentRepository.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) {
        if (existing.checkoutUrl && existing.gatewayPreferenceId) {
          return { dto: this.toResponseDto(existing), created: false };
        }
        // Recuperación: un intento anterior con esta misma Idempotency-Key
        // se cortó entre `save()` y `update()` (crash, reinicio del proceso)
        // y dejó el Payment PENDING sin checkoutUrl/gatewayPreferenceId. Se
        // reintenta sobre el mismo registro en vez de crear uno nuevo:
        // `idempotencyKey` es @unique en la base, así que un segundo
        // `Payment.createForGateway` con la misma clave violaría la
        // constraint. No pasa por los chequeos de cobro único ni recalcula el
        // monto: es el mismo checkout, no uno segundo.
        payment = existing;
      } else {
        payment = await this.createAndSaveGatewayPayment(appointment, dto.idempotencyKey);
      }
    } else {
      payment = await this.createAndSaveGatewayPayment(appointment, generateUuid());
    }

    try {
      const checkout = await this.paymentGateway.createCheckout({
        paymentId: payment.id,
        amount: payment.amount,
        description,
        idempotencyKey: payment.idempotencyKey!,
      });

      payment.recordCheckoutCreated(
        checkout.checkoutUrl,
        checkout.gatewayPreferenceId,
        checkout.expiresAt,
      );
      payment = await this.paymentRepository.update(payment);

      return { dto: this.toResponseDto(payment), created: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown gateway error';
      logger.warn('[CreateCheckout] La pasarela rechazó la creación del checkout', {
        paymentId: payment.id,
        appointmentId: dto.appointmentId,
        reason,
      });

      payment.markAsFailed(reason);
      await this.paymentRepository.update(payment);

      throw translateGatewayFailure(error, {
        retryable: 'The payment gateway rejected the checkout creation. Please try again later.',
        rejected: 'The payment gateway rejected the checkout creation.',
      });
    }
  }

  /**
   * Verifica que la cita pueda cobrarse, calcula el monto y crea + persiste el
   * `Payment` PENDING respaldado por la pasarela
   * @description Se persiste PENDING antes de llamar a la pasarela: el id
   * local viaja como external_reference, así que tiene que existir en la
   * base antes de que la pasarela (o un webhook adelantado) pueda
   * referenciarlo.
   * @throws ConflictError si la cita ya está pagada o ya tiene un checkout abierto
   * @throws NotFoundError si alguno de los servicios de la cita no existe
   * @throws BusinessRuleError si la cita no tiene servicios que cobrar
   * @throws AppError con status 502 si la pasarela falla al revisar un checkout vencido
   */
  private async createAndSaveGatewayPayment(
    appointment: Appointment,
    idempotencyKey: string,
  ): Promise<Payment> {
    await this.chargeGuard.ensureAppointmentIsChargeable(
      appointment.id,
      CHECKOUT_CONFLICT_MESSAGES,
    );

    const amount = await this.calculateAmount(appointment);

    const payment = Payment.createForGateway(
      generateUuid(),
      amount,
      appointment.id,
      PaymentProviderEnum.MERCADO_PAGO,
      idempotencyKey,
    );

    return this.paymentRepository.save(payment);
  }

  /**
   * Calcula el monto a cobrar a partir de los servicios de la cita
   * @description Usa los precios vigentes al momento del checkout. Los precios
   * se guardan en centavos y el pago se expresa en la unidad monetaria base.
   * @returns El monto en la unidad monetaria base
   * @throws NotFoundError si alguno de los servicios de la cita no existe
   * @throws BusinessRuleError si la cita no tiene servicios que cobrar
   */
  private async calculateAmount(appointment: Appointment): Promise<number> {
    const services: Service[] = [];
    for (const serviceId of appointment.serviceIds) {
      const service = await this.serviceRepository.findById(serviceId);
      if (!service) {
        throw new NotFoundError('Service', serviceId);
      }
      services.push(service);
    }

    const stylistAssignments = appointment.stylistId
      ? await this.stylistServiceRepository.findByStylist(appointment.stylistId)
      : [];

    const totalInCents = AppointmentPriceCalculator.totalInCents(services, stylistAssignments);
    if (totalInCents <= 0) {
      throw new BusinessRuleError(
        'Cannot create a checkout for an appointment without services to charge',
      );
    }

    return centsToAmount(totalInCents);
  }

  /**
   * Valida que el usuario tenga permisos para abrir un checkout sobre la
   * cita indicada
   * @throws ForbiddenError si STYLIST/CLIENT no son dueños de la cita
   */
  private validateAccessPermissions(
    appointment: { stylistId?: string; clientId: string; userId: string },
    requesterId: string,
    requesterRole: string,
  ): void {
    if (requesterRole === 'ADMIN') return;

    if (requesterRole === 'STYLIST') {
      if (appointment.stylistId !== requesterId) {
        throw new ForbiddenError('You can only create a checkout for your own appointments');
      }
      return;
    }

    if (requesterRole === 'CLIENT') {
      if (appointment.clientId !== requesterId && appointment.userId !== requesterId) {
        throw new ForbiddenError('You can only create a checkout for your own appointments');
      }
      return;
    }

    throw new ForbiddenError('You can only create a checkout for your own appointments');
  }

  private toResponseDto(payment: Payment): CheckoutResponseDto {
    return {
      paymentId: payment.id,
      amount: payment.amount,
      // No-null assertion: en los dos caminos que llegan acá (checkout recién
      // creado, o reencontrado por idempotencyKey) ya se llamó a
      // recordCheckoutCreated, así que ambos campos están seteados.
      checkoutUrl: payment.checkoutUrl!,
      gatewayPreferenceId: payment.gatewayPreferenceId!,
      expiresAt: payment.effectiveCheckoutExpiresAt,
      status: payment.status,
      provider: payment.provider,
    };
  }
}
