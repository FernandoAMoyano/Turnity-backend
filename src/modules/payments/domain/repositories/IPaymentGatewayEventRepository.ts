import { PaymentGatewayEvent } from '../entities/PaymentGatewayEvent';
import { PaymentProviderEnum } from '../entities/Payment';

/**
 * Interface del repositorio de eventos de pasarela
 * @description Define las operaciones de persistencia para la entidad
 * PaymentGatewayEvent. El contrato está pensado alrededor de la idempotencia
 * entrante: insertar primero y procesar después, apoyándose en la unicidad de
 * (provider, eventId) en la base como cerrojo. Es más fuerte que un lock en
 * memoria o en cache porque es durable y sigue siendo correcto con varias
 * instancias de la API corriendo en paralelo.
 */
export interface IPaymentGatewayEventRepository {
  /**
   * Guarda el evento solo si no fue recibido antes
   * @description Deja que la restricción de unicidad decida la carrera en vez
   * de consultar y después insertar, que tendría una ventana entre ambas
   * operaciones.
   * @param event - Entidad de evento a guardar
   * @returns El evento guardado, o null si ya había sido recibido
   */
  saveIfNotExists(event: PaymentGatewayEvent): Promise<PaymentGatewayEvent | null>;

  /**
   * Marca un evento como procesado con éxito
   * @param id - ID interno del evento
   * @param paymentId - ID del pago local afectado
   * @returns El evento actualizado
   */
  markProcessed(id: string, paymentId?: string): Promise<PaymentGatewayEvent>;

  /**
   * Marca un evento como descartado
   * @param id - ID interno del evento
   * @param reason - Motivo del descarte
   * @returns El evento actualizado
   */
  markIgnored(id: string, reason?: string): Promise<PaymentGatewayEvent>;

  /**
   * Marca un evento como fallido
   * @param id - ID interno del evento
   * @param error - Detalle del fallo
   * @returns El evento actualizado
   */
  markFailed(id: string, error: string): Promise<PaymentGatewayEvent>;

  /**
   * Busca un evento por el identificador que le asignó la pasarela
   * @param provider - Proveedor que emitió la notificación
   * @param eventId - Identificador de la notificación en el proveedor
   * @returns El evento encontrado o null
   */
  findByEventId(
    provider: PaymentProviderEnum,
    eventId: string,
  ): Promise<PaymentGatewayEvent | null>;
}
