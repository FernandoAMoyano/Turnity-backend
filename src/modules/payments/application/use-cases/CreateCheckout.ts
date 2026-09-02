import { generateUuid } from '../../../../shared/utils/uuid';
import { Payment, PaymentProviderEnum } from '../../domain/entities/Payment';
import { IGatewayAwarePaymentRepository } from '../../domain/repositories/IPaymentGatewayLookup';
import { IPaymentGateway } from '../../domain/gateways/IPaymentGateway';
import { IAppointmentRepository } from '../../../appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../../../appointments/domain/repositories/IAppointmentStatusRepository';
import { CreateCheckoutDto } from '../dto/request/CreateCheckoutDto';
import { CheckoutResponseDto } from '../dto/response/CheckoutResponseDto';
import { ValidationError } from '../../../../shared/exceptions/ValidationError';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { BusinessRuleError } from '../../../../shared/exceptions/BusinessRuleError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';
import { ConflictError } from '../../../../shared/exceptions/ConflictError';
import { AppError } from '../../../../shared/exceptions/AppError';
import { logger } from '../../../../shared/logger/logger';

/**
 * Caso de uso para abrir un checkout contra la pasarela de pago
 * @description Crea (o reutiliza, ante un reintento con la misma
 * `Idempotency-Key`) un `Payment` PENDING respaldado por la pasarela, y
 * devuelve la URL de checkout hospedado a la que redirigir al pagador.
 * Ownership (D1 del plan): ADMIN sin restricción, STYLIST solo si es el
 * estilista asignado, CLIENT solo si es el dueño de la cita -- mismo
 * chequeo, reutilizado tal cual, que `GetPaymentsByAppointment`. Es la única
 * mutación que CLIENT gana sobre `payments` (F18 sigue prohibiéndole el
 * resto).
 */
export class CreateCheckout {
  constructor(
    private paymentRepository: IGatewayAwarePaymentRepository,
    private appointmentRepository: IAppointmentRepository,
    private appointmentStatusRepository: IAppointmentStatusRepository,
    private paymentGateway: IPaymentGateway,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param dto - Datos para crear el checkout
   * @param requesterId - ID del usuario que realiza la operación
   * @param requesterRole - Nombre del rol del usuario solicitante
   * @returns El checkout creado (o el ya existente, si `idempotencyKey`
   * coincide con uno anterior) más un flag `created` que el controller usa
   * para elegir 201 vs 200
   * @throws ValidationError si el monto no es válido
   * @throws NotFoundError si la cita no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita
   * @throws BusinessRuleError si la cita no está en un estado válido para pagar
   * @throws ConflictError si ya hay un checkout PENDING abierto para la cita (D5)
   */
  async execute(
    dto: CreateCheckoutDto,
    requesterId: string,
    requesterRole: string,
  ): Promise<{ dto: CheckoutResponseDto; created: boolean }> {
    if (dto.amount <= 0) {
      throw new ValidationError('Amount must be greater than 0');
    }

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
    // en la pasarela (evita el doble cobro por reintento de red del propio
    // cliente, complementario al 409 de abajo que evita el doble checkout
    // por dos acciones distintas del usuario).
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
        // constraint. No pasa por el chequeo 409 de abajo -- es el mismo
        // checkout, no uno segundo.
        payment = existing;
      } else {
        payment = await this.createAndSaveGatewayPayment(appointment.id, dto.amount, dto.idempotencyKey);
      }
    } else {
      payment = await this.createAndSaveGatewayPayment(appointment.id, dto.amount, generateUuid());
    }

    try {
      const checkout = await this.paymentGateway.createCheckout({
        paymentId: payment.id,
        amount: payment.amount,
        description,
        idempotencyKey: payment.idempotencyKey!,
      });

      payment.recordCheckoutCreated(checkout.checkoutUrl, checkout.gatewayPreferenceId);
      payment = await this.paymentRepository.update(payment);

      return {
        dto: this.toResponseDto(payment, checkout.expiresAt),
        created: true,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown gateway error';
      logger.warn('[CreateCheckout] La pasarela rechazó la creación del checkout', {
        paymentId: payment.id,
        appointmentId: dto.appointmentId,
        reason,
      });

      payment.markAsFailed(reason);
      await this.paymentRepository.update(payment);

      // NoopPaymentGateway (§2.3 del plan) lanza BusinessRuleError(422,
      // "Payment gateway is not configured") cuando PAYMENT_GATEWAY_PROVIDER
      // está en 'none' -- es un error de configuración del servidor, no del
      // proveedor externo, así que se repropaga tal cual en vez de forzar el
      // 502 de abajo (matchea el 422 "gateway no configurado" de §5.1).
      if (error instanceof AppError) {
        throw error;
      }

      // MercadoPagoGateway lanza un Error plano ante un fallo real del
      // proveedor (ver `IPaymentGateway.createCheckout`). No se agrega una
      // excepción nueva (mismo criterio que el resto del módulo): se
      // reutiliza AppError directamente con el código BUSINESS_RULE_ERROR
      // que ya entiende el ErrorHandler, pero con status 502 -- es un fallo
      // del proveedor externo, no una regla de negocio violada por el
      // cliente de la API, así que 422 (lo que forzaría BusinessRuleError)
      // sería engañoso.
      throw new AppError(
        'The payment gateway rejected the checkout creation. Please try again later.',
        502,
        'BUSINESS_RULE_ERROR',
      );
    }
  }

  /**
   * Valida D5 (un solo checkout PENDING por cita) y crea + persiste el
   * `Payment` PENDING respaldado por la pasarela
   * @description Se persiste PENDING antes de llamar a la pasarela: el id
   * local viaja como external_reference, así que tiene que existir en la
   * base antes de que la pasarela (o un webhook adelantado) pueda
   * referenciarlo.
   * @throws ConflictError si ya hay un checkout PENDING abierto para la cita
   */
  private async createAndSaveGatewayPayment(
    appointmentId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<Payment> {
    // D5: un solo checkout PENDING por cita. Dos preferencias abiertas a la
    // vez sobre la misma cita son un doble cobro desde la perspectiva del
    // cliente, aunque cada Payment sea individualmente idempotente.
    const paymentsForAppointment = await this.paymentRepository.findByAppointmentId(
      appointmentId,
    );
    const hasOpenCheckout = paymentsForAppointment.some(
      (payment) => payment.isGatewayBacked && payment.isPending,
    );
    if (hasOpenCheckout) {
      throw new ConflictError(
        'There is already a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it.',
      );
    }

    const payment = Payment.createForGateway(
      generateUuid(),
      amount,
      appointmentId,
      PaymentProviderEnum.MERCADO_PAGO,
      idempotencyKey,
    );

    return this.paymentRepository.save(payment);
  }

  /**
   * Valida que el usuario tenga permisos para abrir un checkout sobre la
   * cita indicada (D1: ampliación acotada de F18, solo para este endpoint)
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

  private toResponseDto(payment: Payment, expiresAt?: Date): CheckoutResponseDto {
    return {
      paymentId: payment.id,
      // No-null assertion: en los dos caminos que llegan acá (checkout recién
      // creado, o reencontrado por idempotencyKey) ya se llamó a
      // recordCheckoutCreated, así que ambos campos están seteados.
      checkoutUrl: payment.checkoutUrl!,
      gatewayPreferenceId: payment.gatewayPreferenceId!,
      // Si el pago se reencontró por idempotencyKey, no tenemos el
      // GatewayCheckout original (Payment no persiste expiresAt, ver D6 /
      // handoff de F2) -- se aproxima con la ventana fija del plan sobre
      // createdAt, que es lo mismo que calculó MercadoPagoGateway al crearlo.
      expiresAt: expiresAt ?? this.approximateExpiration(payment.createdAt),
      status: payment.status,
      provider: payment.provider,
    };
  }

  /**
   * Aproxima el vencimiento de una preferencia ya creada, para la respuesta
   * de idempotencia (200), a partir de la ventana fija de D6. `Payment` no
   * persiste `expiresAt` (ver `checkout-y-vencimiento` en el handoff de F2):
   * solo la pasarela lo sabe con certeza. Sirve para mostrarlo en la
   * respuesta; no se usa para ninguna decisión de negocio.
   */
  private approximateExpiration(createdAt: Date): Date {
    const CHECKOUT_EXPIRATION_MINUTES = 30;
    return new Date(createdAt.getTime() + CHECKOUT_EXPIRATION_MINUTES * 60_000);
  }
}
