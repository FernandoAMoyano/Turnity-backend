import { Payment } from '../entities/Payment';
import { IPaymentRepository } from './IPaymentRepository';

/**
 * Interface de búsqueda de pagos por identificadores de pasarela
 * @description Se declara aparte de IPaymentRepository, y no como métodos
 * nuevos dentro de ella, por segregación de interfaces: solo los casos de uso
 * del cobro por pasarela necesitan estas búsquedas, y el resto del módulo sigue
 * dependiendo del contrato mínimo. La implementación es la misma clase.
 */
export interface IPaymentGatewayLookup {
  /**
   * Busca un pago por su identificador en la pasarela
   * @param gatewayPaymentId - ID del pago asignado por el proveedor
   * @returns El pago encontrado o null
   */
  findByGatewayPaymentId(gatewayPaymentId: string): Promise<Payment | null>;

  /**
   * Busca un pago por su clave de idempotencia
   * @description Es la consulta que evita el doble cobro: un reintento del
   * cliente con la misma clave debe devolver el checkout ya creado en vez de
   * generar una segunda intención de pago en el proveedor.
   * @param idempotencyKey - Clave de idempotencia del pago
   * @returns El pago encontrado o null
   */
  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null>;
}

/**
 * Repositorio de pagos con capacidad de búsqueda por identificadores de pasarela
 * @description Tipo de conveniencia para inyectar en los casos de uso que
 * necesitan ambos contratos a la vez.
 */
export type IGatewayAwarePaymentRepository = IPaymentRepository & IPaymentGatewayLookup;
