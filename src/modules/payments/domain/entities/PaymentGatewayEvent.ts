import { PaymentProviderEnum } from './Payment';

/**
 * Enum para los estados de un evento recibido desde una pasarela
 * @description RECEIVED es el estado inicial, con el que el evento se inserta
 * antes de procesarlo. Los otros tres son terminales: PROCESSED cuando el
 * evento modificó o confirmó el estado de un pago, IGNORED cuando el evento es
 * válido pero no aplica a ningún pago nuestro, y FAILED cuando el
 * procesamiento se cortó por un fallo transitorio y conviene reintentarlo.
 */
export enum GatewayEventStatusEnum {
  RECEIVED = 'RECEIVED',
  PROCESSED = 'PROCESSED',
  IGNORED = 'IGNORED',
  FAILED = 'FAILED',
}

/**
 * Interface para las propiedades del evento de pasarela
 */
export interface PaymentGatewayEventProps {
  id: string;
  provider: PaymentProviderEnum;
  eventId: string;
  eventType: string;
  paymentId?: string;
  status: GatewayEventStatusEnum;
  signatureValid: boolean;
  rawPayload: unknown;
  error?: string;
  receivedAt: Date;
  processedAt?: Date;
}

/**
 * Entidad PaymentGatewayEvent
 * @description Representa una notificación recibida de una pasarela de pago.
 * Existe para dos cosas: deduplicar los reintentos del proveedor, apoyándose en
 * la unicidad de (provider, eventId) en la base, y conservar el payload crudo
 * como registro de auditoría, de modo que un evento se pueda reprocesar sin
 * volver a consultar al proveedor.
 */
export class PaymentGatewayEvent {
  private readonly _id: string;
  private readonly _provider: PaymentProviderEnum;
  private readonly _eventId: string;
  private readonly _eventType: string;
  private _paymentId?: string;
  private _status: GatewayEventStatusEnum;
  private readonly _signatureValid: boolean;
  private readonly _rawPayload: unknown;
  private _error?: string;
  private readonly _receivedAt: Date;
  private _processedAt?: Date;

  constructor(props: PaymentGatewayEventProps) {
    this._id = props.id;
    this._provider = props.provider;
    this._eventId = props.eventId;
    this._eventType = props.eventType;
    this._paymentId = props.paymentId;
    this._status = props.status;
    this._signatureValid = props.signatureValid;
    this._rawPayload = props.rawPayload;
    this._error = props.error;
    this._receivedAt = props.receivedAt;
    this._processedAt = props.processedAt;
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get provider(): PaymentProviderEnum {
    return this._provider;
  }

  /**
   * Identificador de la notificación asignado por la pasarela
   * @description Junto con el proveedor forma la clave de deduplicación.
   */
  get eventId(): string {
    return this._eventId;
  }

  /**
   * Tipo de notificación informado por la pasarela
   */
  get eventType(): string {
    return this._eventType;
  }

  /**
   * ID del pago local al que se resolvió el evento (ausente hasta resolverlo,
   * o si el evento no corresponde a ningún pago nuestro)
   */
  get paymentId(): string | undefined {
    return this._paymentId;
  }

  get status(): GatewayEventStatusEnum {
    return this._status;
  }

  /**
   * Resultado de la verificación de firma al momento de recibir el evento
   */
  get signatureValid(): boolean {
    return this._signatureValid;
  }

  /**
   * Payload crudo tal como llegó, para auditoría y reproceso
   * @description Se tipa como unknown a propósito: la forma la define cada
   * proveedor y solo su adapter sabe interpretarla.
   */
  get rawPayload(): unknown {
    return this._rawPayload;
  }

  /**
   * Detalle del fallo, o motivo por el que el evento se descartó
   */
  get error(): string | undefined {
    return this._error;
  }

  get receivedAt(): Date {
    return this._receivedAt;
  }

  /**
   * Momento en que el evento alcanzó un estado terminal
   */
  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  /**
   * Verifica si el evento todavía no fue procesado
   */
  get isPending(): boolean {
    return this._status === GatewayEventStatusEnum.RECEIVED;
  }

  /**
   * Verifica si el evento fue procesado con éxito
   */
  get isProcessed(): boolean {
    return this._status === GatewayEventStatusEnum.PROCESSED;
  }

  /**
   * Marca el evento como procesado con éxito
   * @description No lanza ante una segunda invocación. El ciclo de vida del
   * evento es lineal y está garantizado aguas arriba por la unicidad de
   * (provider, eventId); el manejador del webhook no puede permitirse una
   * excepción por una transición, porque devolvería un 5xx y provocaría más
   * reintentos del proveedor.
   * @param paymentId - ID del pago local afectado
   */
  markAsProcessed(paymentId?: string): void {
    this._status = GatewayEventStatusEnum.PROCESSED;
    if (paymentId) this._paymentId = paymentId;
    this._processedAt = new Date();
  }

  /**
   * Marca el evento como descartado
   * @description Se usa cuando el evento es legítimo pero no aplica a ningún
   * pago del sistema. Reintentarlo no cambiaría nada, así que el webhook
   * responde 200 igual.
   * @param reason - Motivo del descarte
   */
  markAsIgnored(reason?: string): void {
    this._status = GatewayEventStatusEnum.IGNORED;
    if (reason) this._error = reason;
    this._processedAt = new Date();
  }

  /**
   * Marca el evento como fallido
   * @description Reservado para fallos transitorios donde el reintento del
   * proveedor sí puede ayudar.
   * @param error - Detalle del fallo
   */
  markAsFailed(error: string): void {
    this._status = GatewayEventStatusEnum.FAILED;
    this._error = error;
    this._processedAt = new Date();
  }

  /**
   * Convierte la entidad a un objeto plano
   */
  toObject(): PaymentGatewayEventProps {
    return {
      id: this._id,
      provider: this._provider,
      eventId: this._eventId,
      eventType: this._eventType,
      paymentId: this._paymentId,
      status: this._status,
      signatureValid: this._signatureValid,
      rawPayload: this._rawPayload,
      error: this._error,
      receivedAt: this._receivedAt,
      processedAt: this._processedAt,
    };
  }

  /**
   * Factory method para registrar un evento recién recibido
   * @param id - ID interno del evento
   * @param provider - Proveedor que emitió la notificación
   * @param eventId - Identificador de la notificación en el proveedor
   * @param eventType - Tipo de notificación informado por el proveedor
   * @param signatureValid - Resultado de la verificación de firma
   * @param rawPayload - Payload crudo, tal como llegó
   * @param paymentId - ID del pago local, si ya se resolvió
   */
  static create(
    id: string,
    provider: PaymentProviderEnum,
    eventId: string,
    eventType: string,
    signatureValid: boolean,
    rawPayload: unknown,
    paymentId?: string,
  ): PaymentGatewayEvent {
    if (!eventId) {
      throw new Error('Event id is required');
    }
    if (!eventType) {
      throw new Error('Event type is required');
    }

    return new PaymentGatewayEvent({
      id,
      provider,
      eventId,
      eventType,
      paymentId,
      status: GatewayEventStatusEnum.RECEIVED,
      signatureValid,
      rawPayload,
      receivedAt: new Date(),
    });
  }
}
