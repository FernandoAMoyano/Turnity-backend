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
import { ConflictError } from '../../../../shared/exceptions/ConflictError';
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
 * Mensajes con los que se rechaza un pedido por su `Idempotency-Key`
 */
const KEY_USED_FOR_ANOTHER_APPOINTMENT_MESSAGE =
  'This Idempotency-Key was already used for another appointment. Use a new key.';
const KEY_OF_UNRESUMABLE_CHECKOUT_MESSAGE =
  'This Idempotency-Key belongs to a checkout that could not be created. Use a new key to try again.';
const CHECKOUT_BEING_CREATED_MESSAGE =
  'A checkout with this Idempotency-Key is still being created. Retry the request in a few seconds.';

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
 * Un pedido con una `Idempotency-Key` ya usada devuelve el checkout de esa
 * clave, retoma uno que se cortó antes de anotar su URL, o se rechaza si la
 * clave es de otra cita o de un checkout que no se pudo crear. Dos pedidos
 * simultáneos con la misma clave terminan en un solo pago.
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
   * pagar o no tiene servicios que cobrar, o si la `idempotencyKey` ya se usó
   * para otra cita o pertenece a un checkout que no se pudo crear
   * @throws ConflictError si la cita ya está pagada o ya tiene un checkout
   * abierto, o si otro pedido con la misma `idempotencyKey` todavía está
   * creando el checkout
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

    const description = dto.description ?? `Payment for appointment ${appointment.id}`;

    if (!dto.idempotencyKey) {
      const payment = await this.createAndSaveGatewayPayment(appointment, generateUuid());
      return { dto: await this.openCheckout(payment, description), created: true };
    }

    // Idempotencia saliente: un reintento del cliente con la misma clave
    // devuelve el checkout ya creado en vez de abrir una segunda preferencia
    // en la pasarela. Complementa los chequeos de cobro único, que evitan un
    // segundo checkout por dos acciones distintas del usuario.
    const existing = await this.paymentRepository.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) {
      this.ensureKeyBelongsToAppointment(existing, dto.appointmentId);
      if (this.hasRecordedCheckout(existing)) {
        return { dto: this.toResponseDto(existing), created: false };
      }
      this.ensureCheckoutCanBeResumed(existing);
      // Recuperación: un intento anterior con esta misma Idempotency-Key
      // se cortó entre `save()` y `update()` (crash, reinicio del proceso)
      // y dejó el Payment PENDING sin checkoutUrl/gatewayPreferenceId. Se
      // reintenta sobre el mismo registro en vez de crear uno nuevo:
      // `idempotencyKey` es @unique en la base, así que un segundo
      // `Payment.createForGateway` con la misma clave violaría la
      // constraint. No pasa por los chequeos de cobro único ni recalcula el
      // monto: es el mismo checkout, no uno segundo. Este camino no distingue
      // un intento cortado de uno que todavía está en curso: en ese caso se
      // crea una segunda preferencia para el mismo pago, y cualquiera de las
      // dos que se pague se registra sobre él.
      return { dto: await this.openCheckout(existing, description), created: true };
    }

    let payment: Payment;
    try {
      payment = await this.createAndSaveGatewayPayment(appointment, dto.idempotencyKey);
    } catch (error) {
      const concurrent = await this.resolveConcurrentRequest(
        error,
        dto.idempotencyKey,
        dto.appointmentId,
      );
      return { dto: concurrent, created: false };
    }

    return { dto: await this.openCheckout(payment, description), created: true };
  }

  /**
   * Crea la preferencia en la pasarela para un pago PENDING ya guardado y la
   * anota en el pago
   * @param payment - Pago PENDING respaldado por la pasarela
   * @param description - Descripción del cobro que ve el pagador
   * @returns El checkout creado
   * @throws AppError con status 502 si la pasarela falla; el pago queda FAILED
   * con el motivo
   */
  private async openCheckout(payment: Payment, description: string): Promise<CheckoutResponseDto> {
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
      const updated = await this.paymentRepository.update(payment);

      return this.toResponseDto(updated);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown gateway error';
      logger.warn('[CreateCheckout] La pasarela rechazó la creación del checkout', {
        paymentId: payment.id,
        appointmentId: payment.appointmentId,
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
   * Resuelve el alta fallida de un checkout cuando otro pedido con la misma
   * clave de idempotencia guardó su pago primero
   * @description Dos pedidos simultáneos con la misma clave no encuentran el
   * pago del otro en la búsqueda inicial. Según el momento, el que guarda
   * segundo choca con el cobro único (el checkout del primero ya cuenta como
   * abierto), con el índice de checkout abierto o con la restricción única de
   * la clave. Si existe un pago con esa clave, este pedido es un reintento del
   * mismo checkout y no un conflicto con otro.
   * @param error - Error con el que falló el alta
   * @param idempotencyKey - Clave de idempotencia del pedido
   * @param appointmentId - Cita del pedido
   * @returns El checkout del pedido que guardó primero, si ya tiene su URL
   * @throws El error original si no es un conflicto o si ningún pago tiene la clave
   * @throws BusinessRuleError si la clave es de otra cita o de un checkout que
   * no se pudo crear
   * @throws ConflictError si el pedido que guardó primero todavía está creando
   * el checkout
   */
  private async resolveConcurrentRequest(
    error: unknown,
    idempotencyKey: string,
    appointmentId: string,
  ): Promise<CheckoutResponseDto> {
    if (!(error instanceof ConflictError)) {
      throw error;
    }

    const winner = await this.paymentRepository.findByIdempotencyKey(idempotencyKey);
    if (!winner) {
      throw error;
    }

    this.ensureKeyBelongsToAppointment(winner, appointmentId);
    if (this.hasRecordedCheckout(winner)) {
      return this.toResponseDto(winner);
    }
    this.ensureCheckoutCanBeResumed(winner);
    throw new ConflictError(CHECKOUT_BEING_CREATED_MESSAGE);
  }

  /**
   * Verifica que la clave de idempotencia se haya usado para la misma cita
   * @description Reusar una clave con otra cita es un error de quien llama, y
   * devolver el checkout de esa otra cita expondría un pago sobre el que no se
   * validaron permisos.
   * @throws BusinessRuleError si el pago de la clave es de otra cita
   */
  private ensureKeyBelongsToAppointment(payment: Payment, appointmentId: string): void {
    if (payment.appointmentId !== appointmentId) {
      throw new BusinessRuleError(KEY_USED_FOR_ANOTHER_APPOINTMENT_MESSAGE);
    }
  }

  /**
   * Verifica que un checkout sin URL todavía pueda retomarse
   * @description Solo un pago PENDING puede retomarse. Un checkout que falló al
   * crearse queda FAILED, y reintentarlo sobre ese pago anotaría una URL de pago
   * vigente en un pago fallido. Para volver a intentar hace falta una clave
   * nueva, que pasa otra vez por el cobro único y recalcula el monto.
   * @throws BusinessRuleError si el pago ya no está PENDING
   */
  private ensureCheckoutCanBeResumed(payment: Payment): void {
    if (!payment.isPending) {
      throw new BusinessRuleError(KEY_OF_UNRESUMABLE_CHECKOUT_MESSAGE);
    }
  }

  /**
   * Indica si el pago ya tiene anotada la preferencia creada en la pasarela
   */
  private hasRecordedCheckout(payment: Payment): boolean {
    return Boolean(payment.checkoutUrl && payment.gatewayPreferenceId);
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
      // No-null assertion: solo se llega acá con un checkout recién anotado
      // o con un pago que `hasRecordedCheckout` confirmó, así que ambos campos
      // están seteados.
      checkoutUrl: payment.checkoutUrl!,
      gatewayPreferenceId: payment.gatewayPreferenceId!,
      expiresAt: payment.effectiveCheckoutExpiresAt,
      status: payment.status,
      provider: payment.provider,
    };
  }
}
