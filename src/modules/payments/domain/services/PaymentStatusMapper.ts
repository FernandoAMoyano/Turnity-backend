import { PaymentStatusEnum } from '../entities/Payment';
import { logger } from '../../../../shared/logger/logger';

/**
 * Mapeo de estados crudos de Mercado Pago a los cuatro estados internos
 * @description Servicio de dominio puro (sin I/O, 100% testeable): toma el
 * estado crudo que informa la pasarela y devuelve el `PaymentStatusEnum`
 * correspondiente. Un estado no reconocido no lanza una excepción -- cae en PENDING y se
 * registra, porque un valor nuevo que Mercado Pago agregue sin aviso no
 * puede tumbar el procesamiento de un webhook (la regla de oro de
 * `Payment.applyGatewayStatus`: nunca lanza una excepción).
 */

/**
 * Tabla de mapeo para los estados de pago documentados por Mercado Pago.
 * `in_mediation` y `charged_back` mapean sin lanzar una excepción, pero ameritan un log en
 * nivel distinto de info -- ver `toInternalStatus`.
 */
const KNOWN_STATUS_MAP: Readonly<Record<string, PaymentStatusEnum>> = {
  approved: PaymentStatusEnum.COMPLETED,
  authorized: PaymentStatusEnum.PENDING,
  pending: PaymentStatusEnum.PENDING,
  in_process: PaymentStatusEnum.PENDING,
  in_mediation: PaymentStatusEnum.PENDING,
  rejected: PaymentStatusEnum.FAILED,
  cancelled: PaymentStatusEnum.FAILED,
  refunded: PaymentStatusEnum.REFUNDED,
  // no hay estado interno para contracargos, se colapsa a REFUNDED --
  // el dinero se fue. gatewayStatus preserva la distinción para auditoría.
  charged_back: PaymentStatusEnum.REFUNDED,
};

/** Estados fuera de alcance de la app, sin acción automática posible */
const WARN_STATUSES = new Set(['in_mediation']);
/** Estados que ameritan escalar el log: el dinero salió sin que la app actuara */
const ERROR_STATUSES = new Set(['charged_back']);

export class PaymentStatusMapper {
  /**
   * Traduce un estado crudo de Mercado Pago al estado interno correspondiente
   * @param rawStatus - Estado tal como lo informa la pasarela (ej. "approved")
   * @returns El PaymentStatusEnum correspondiente; PENDING para cualquier
   * estado no reconocido; nunca lanza una excepción
   */
  static toInternalStatus(rawStatus: string): PaymentStatusEnum {
    const mapped = KNOWN_STATUS_MAP[rawStatus];

    if (!mapped) {
      logger.warn(
        '[PaymentStatusMapper] estado de Mercado Pago no reconocido, se trata como PENDING',
        { rawStatus },
      );
      return PaymentStatusEnum.PENDING;
    }

    if (ERROR_STATUSES.has(rawStatus)) {
      logger.error(
        '[PaymentStatusMapper] contracargo recibido, colapsado a REFUNDED (resolución operativa, fuera de la app)',
        { rawStatus },
      );
    } else if (WARN_STATUSES.has(rawStatus)) {
      logger.warn(
        '[PaymentStatusMapper] estado fuera de alcance de la app, sin cambio de estado interno',
        { rawStatus },
      );
    }

    return mapped;
  }
}
