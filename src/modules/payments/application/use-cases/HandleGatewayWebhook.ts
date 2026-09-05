import { generateUuid } from '../../../../shared/utils/uuid';
import { Payment, PaymentProviderEnum } from '../../domain/entities/Payment';
import { PaymentGatewayEvent } from '../../domain/entities/PaymentGatewayEvent';
import { PaymentStatusMapper } from '../../domain/services/PaymentStatusMapper';
import { IGatewayAwarePaymentRepository } from '../../domain/repositories/IPaymentGatewayLookup';
import { IPaymentGatewayEventRepository } from '../../domain/repositories/IPaymentGatewayEventRepository';
import {
  IPaymentGateway,
  GatewayNotification,
  GatewayPaymentSnapshot,
} from '../../domain/gateways/IPaymentGateway';
import { GatewayWebhookDto } from '../dto/request/GatewayWebhookDto';
import { logger } from '../../../../shared/logger/logger';

/**
 * Resultado del procesamiento de una notificación de webhook
 * @description Cinco desenlaces, y el controller los traduce a solo tres
 * códigos HTTP: `unauthorized` -> 401, `retryable` -> 500, y los otros tres
 * -> 200. La distinción entre `processed`, `duplicate` e `ignored` no cambia
 * la respuesta (las tres son terminales: reintentar no cambiaría nada), pero
 * sí el log y los asserts de los tests.
 */
export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'unauthorized' | 'retryable';

/**
 * Desenlace del procesamiento, más el contexto para loguear y para los tests
 */
export interface HandleGatewayWebhookResult {
  /** Qué pasó con la notificación */
  outcome: WebhookOutcome;
  /** Explicación del desenlace, cuando aporta (motivo del descarte, error) */
  detail?: string;
  /** Identificador de la notificación en el proveedor, si se llegó a parsear */
  eventId?: string;
  /** ID del pago local afectado, si se llegó a resolver */
  paymentId?: string;
}

/**
 * Tipo de notificación que este caso de uso sabe procesar
 * @description Mercado Pago manda además `merchant_order`, `subscription`,
 * `invoice`, `point_integration_wh` y otros por la misma URL. Todos se
 * registran (para auditoría y dedup) y se descartan con 200: son legítimos,
 * pero no mueven el estado de ningún `Payment` nuestro. Vive acá y no en el
 * puerto porque es una sola constante, del mismo tamaño que el vocabulario
 * crudo de estados que `PaymentStatusMapper` ya conoce.
 */
const SUPPORTED_EVENT_TYPE = 'payment';

/**
 * Caso de uso para procesar una notificación de webhook de la pasarela
 * @description Es el camino automático que completa un cobro: la pasarela
 * avisa que algo cambió, y esta clase decide si eso mueve el estado de un
 * `Payment` local. Cuatro invariantes:
 *
 * 1. **La firma es la única barrera** y se verifica antes de cualquier I/O.
 *    Un atacante sin el secreto no puede ni generar una escritura.
 * 2. **Nunca se confía en el payload.** El estado sale siempre de
 *    `gateway.getPayment()` con el access token propio; el body solo dice
 *    *qué* recurso mirar, nunca *cómo* quedó.
 * 3. **Nunca lanza una excepción por lógica de negocio.** Todo desenlace
 *    previsible es un valor de retorno, porque la pasarela reintenta ante
 *    cualquier respuesta no-2xx, y un 500 por un pago inexistente sería un
 *    loop de reintentos eterno.
 * 4. **Idempotencia entrante por la base**, no por lock en memoria:
 *    `saveIfNotExists` inserta y deja que el `@unique (provider, eventId)`
 *    decida la carrera. Sigue siendo correcto con N instancias de la API.
 */
export class HandleGatewayWebhook {
  constructor(
    private paymentRepository: IGatewayAwarePaymentRepository,
    private eventRepository: IPaymentGatewayEventRepository,
    private paymentGateway: IPaymentGateway,
  ) {}

  /**
   * Ejecuta el caso de uso
   * @param dto - Datos crudos del request del webhook, ya extraídos por el
   * controller (tipo `GatewayWebhookDto`)
   * @returns El desenlace del procesamiento (tipo
   * `HandleGatewayWebhookResult`); nunca lanza una excepción por lógica de
   * negocio. Un fallo de infraestructura fuera de los dos puntos que este
   * método sí atrapa (el re-fetch y la persistencia del pago) se propaga, y
   * el controller lo traduce a 500 -- que es la respuesta correcta, porque en
   * ese caso el reintento de la pasarela puede ayudar.
   */
  async execute(dto: GatewayWebhookDto): Promise<HandleGatewayWebhookResult> {
    // 1. Firma: la única barrera de un endpoint público sin autenticación.
    // Se verifica antes de tocar la base, así que una notificación
    // falsificada no genera ni una sola escritura.
    const signatureValid = this.paymentGateway.verifyWebhookSignature({
      xSignature: dto.xSignature,
      xRequestId: dto.xRequestId,
      dataId: dto.dataId,
    });

    if (!signatureValid) {
      // Sin detalle del motivo, ni en el log ni en la respuesta: decirle a
      // quien firma mal por qué falló es ayudarlo a acertar.
      logger.warn('[HandleGatewayWebhook] firma de webhook rechazada');
      return { outcome: 'unauthorized' };
    }

    // 2. Parseo del body crudo. La firma de Mercado Pago cubre `data.id`,
    // `x-request-id` y `ts`, NO los bytes del cuerpo, así que una firma
    // válida no garantiza un body bien formado. Reintentar no lo va a
    // arreglar -> 200 sin registrar nada (sin `eventId` no hay clave de
    // dedup con la que insertar el evento).
    let notification: GatewayNotification;
    try {
      notification = this.paymentGateway.parseWebhookNotification(dto.rawBody);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown parse error';
      logger.warn('[HandleGatewayWebhook] payload de webhook malformado, se descarta', { detail });
      return { outcome: 'ignored', detail };
    }

    // 3. Idempotencia entrante. Se inserta el evento ANTES de re-fetchear:
    // si la pasarela ya mandó esta misma notificación, el
    // `@unique (provider, eventId)` la rechaza y cortamos acá, sin gastar una
    // llamada de red.
    const event = PaymentGatewayEvent.create(
      generateUuid(),
      PaymentProviderEnum.MERCADO_PAGO,
      notification.eventId,
      notification.eventType,
      signatureValid,
      this.decodeRawPayload(dto.rawBody),
    );

    const saved = await this.eventRepository.saveIfNotExists(event);
    if (!saved) {
      logger.info('[HandleGatewayWebhook] notificación duplicada, ya procesada antes', {
        eventId: notification.eventId,
      });
      return { outcome: 'duplicate', eventId: notification.eventId };
    }

    // 4. Tipos de notificación fuera de alcance: quedan registrados para
    // auditoría y deduplicados, pero no mueven ningún pago.
    if (notification.eventType !== SUPPORTED_EVENT_TYPE) {
      const detail = `Unsupported event type: ${notification.eventType}`;
      await this.eventRepository.markIgnored(saved.id, detail);
      logger.info('[HandleGatewayWebhook] tipo de notificación fuera de alcance', {
        eventId: notification.eventId,
        eventType: notification.eventType,
      });
      return { outcome: 'ignored', detail, eventId: notification.eventId };
    }

    // 5. Re-fetch autoritativo del estado: el body de la notificación solo
    // dice qué recurso mirar, nunca cómo quedó. Es la única llamada de
    // red del flujo, y el único punto donde un fallo transitorio amerita un 500.
    let snapshot: GatewayPaymentSnapshot | null;
    try {
      snapshot = await this.paymentGateway.getPayment(notification.resourceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown gateway error';
      await this.eventRepository.markFailed(saved.id, detail);
      logger.error('[HandleGatewayWebhook] la pasarela no respondió al re-fetchear el pago', {
        eventId: notification.eventId,
        resourceId: notification.resourceId,
        detail,
      });
      return { outcome: 'retryable', detail, eventId: notification.eventId };
    }

    if (!snapshot) {
      // La pasarela no reconoce el recurso con nuestras credenciales (404).
      // Reintentar no lo va a hacer aparecer.
      const detail = `Gateway does not recognize resource ${notification.resourceId}`;
      await this.eventRepository.markIgnored(saved.id, detail);
      logger.warn('[HandleGatewayWebhook] la pasarela no reconoce el recurso notificado', {
        eventId: notification.eventId,
        resourceId: notification.resourceId,
      });
      return { outcome: 'ignored', detail, eventId: notification.eventId };
    }

    // 6. Resolver a qué `Payment` local corresponde la notificación.
    const payment = await this.resolveLocalPayment(snapshot, notification.resourceId);
    if (!payment) {
      const detail = `No local payment matches gateway payment ${notification.resourceId}`;
      await this.eventRepository.markIgnored(saved.id, detail);
      logger.warn('[HandleGatewayWebhook] notificación sin pago local asociado, se descarta', {
        eventId: notification.eventId,
        resourceId: notification.resourceId,
        externalReference: snapshot.externalReference,
      });
      return { outcome: 'ignored', detail, eventId: notification.eventId };
    }

    // 7. Aplicar el estado. `applyGatewayStatus` es idempotente y no lanza
    // ninguna excepción: devuelve 'applied' si movió el estado, 'noop' ante
    // un replay y 'conflict' ante una transición imposible. En los tres casos
    // refresca los datos de auditoría (estado crudo y lastSyncedAt).
    const internalStatus = PaymentStatusMapper.toInternalStatus(snapshot.status);
    const transition = payment.applyGatewayStatus({
      status: internalStatus,
      gatewayStatus: snapshot.status,
      gatewayPaymentId: snapshot.gatewayPaymentId || notification.resourceId,
      failureReason: snapshot.statusDetail,
      refundedAmount: snapshot.refundedAmount,
    });

    try {
      await this.paymentRepository.update(payment);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown persistence error';
      await this.eventRepository.markFailed(saved.id, detail);
      logger.error('[HandleGatewayWebhook] no se pudo persistir el pago actualizado', {
        eventId: notification.eventId,
        paymentId: payment.id,
        detail,
      });
      return { outcome: 'retryable', detail, eventId: notification.eventId, paymentId: payment.id };
    }

    await this.eventRepository.markProcessed(saved.id, payment.id);

    if (transition === 'conflict') {
      // El evento SÍ corresponde a un pago nuestro (por eso PROCESSED y no
      // IGNORED) y ya no hay nada que reintentar, pero la transición era
      // imposible: llegó tarde y en el medio el pago avanzó a un estado
      // terminal. Caso típico: un replay del `approved` original después de
      // un reembolso hecho desde el panel de la pasarela.
      logger.warn('[HandleGatewayWebhook] transición imposible, el pago no se movió', {
        eventId: notification.eventId,
        paymentId: payment.id,
        currentStatus: payment.status,
        gatewayStatus: snapshot.status,
      });
    } else {
      logger.info('[HandleGatewayWebhook] notificación procesada', {
        eventId: notification.eventId,
        paymentId: payment.id,
        gatewayStatus: snapshot.status,
        transition,
      });
    }

    return {
      outcome: 'processed',
      detail: transition,
      eventId: notification.eventId,
      paymentId: payment.id,
    };
  }

  /**
   * Busca el `Payment` local al que corresponde la notificación
   * @description Dos caminos, en orden de confiabilidad. El primero es el
   * `external_reference`: es el `Payment.id` que nosotros mismos le mandamos
   * a la pasarela al crear la preferencia, así que es la referencia
   * autoritativa. El segundo es el `gatewayPaymentId`, que sirve para las
   * notificaciones siguientes del mismo pago (una vez que la primera lo
   * persistió) y cubre el caso de una preferencia creada fuera de este
   * sistema.
   * @param snapshot - Estado autoritativo traído de la pasarela
   * @param resourceId - `data.id` de la notificación
   * @returns El pago local, o `null` si ninguno de los dos caminos lo
   * encuentra
   */
  private async resolveLocalPayment(
    snapshot: GatewayPaymentSnapshot,
    resourceId: string,
  ): Promise<Payment | null> {
    if (snapshot.externalReference) {
      const byReference = await this.paymentRepository.findById(snapshot.externalReference);
      if (byReference) {
        return byReference;
      }
    }

    return this.paymentRepository.findByGatewayPaymentId(snapshot.gatewayPaymentId || resourceId);
  }

  /**
   * Prepara el body crudo para persistirlo como `rawPayload` del evento
   * @description La columna es `Json` en Postgres, así que se guarda el JSON
   * parseado cuando se puede. Si el body no es JSON válido no se llega hasta
   * acá (el parseo del paso 2 ya cortó), pero el fallback existe igual: un
   * `rawPayload` ilegible no puede tumbar el registro de auditoría del
   * evento, que es justamente lo que sirve para diagnosticar el problema.
   * @param raw - Body tal como llegó
   * @returns El payload parseado, o un objeto con el texto crudo si no se
   * puede parsear
   */
  private decodeRawPayload(raw: Buffer): unknown {
    try {
      return JSON.parse(raw.toString('utf-8'));
    } catch {
      return { unparsed: raw.toString('utf-8') };
    }
  }
}
