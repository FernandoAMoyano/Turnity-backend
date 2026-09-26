import {
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../domain/entities/Payment';

/**
 * DTO de respuesta para un pago
 * @description Representa la estructura de datos de un pago en las respuestas de la API
 */
export interface PaymentResponseDto {
  /**
   * ID único del pago
   */
  id: string;

  /**
   * Monto del pago
   */
  amount: number;

  /**
   * Estado actual del pago
   */
  status: PaymentStatusEnum;

  /**
   * Método de pago utilizado (null si está pendiente)
   */
  method: PaymentMethodEnum | null;

  /**
   * Fecha en que se procesó el pago (null si está pendiente)
   */
  paymentDate: Date | null;

  /**
   * ID de la cita asociada
   */
  appointmentId: string;

  /**
   * Razón del reembolso (disponible si el pago fue reembolsado)
   */
  refundReason?: string;

  /**
   * Fecha de creación del registro
   */
  createdAt: Date;

  /**
   * Fecha de última actualización
   */
  updatedAt: Date;

  // Campos de pasarela. Todos opcionales y aditivos: un pago manual no tiene
  // ninguno, y los consumidores que ya existían no ven ningún cambio. Hoy los
  // completan los dos casos de uso que hablan con la pasarela (reembolso y
  // sincronización); el resto de los endpoints los sigue omitiendo.
  // Nunca se expone `idempotencyKey`: es una credencial de deduplicación.

  /**
   * Proveedor que respalda el pago
   */
  provider?: PaymentProviderEnum;

  /**
   * Identificador del pago en la pasarela
   */
  gatewayPaymentId?: string;

  /**
   * Estado crudo informado por la pasarela, sin traducir al dominio
   */
  gatewayStatus?: string;

  /**
   * Monto efectivamente reembolsado por la pasarela
   */
  refundedAmount?: number;

  /**
   * Identificador del reembolso en la pasarela
   */
  gatewayRefundId?: string;

  /**
   * Motivo del rechazo informado por la pasarela
   */
  failureReason?: string;

  /**
   * Momento de la última relectura del estado contra la pasarela
   */
  lastSyncedAt?: Date;
}
