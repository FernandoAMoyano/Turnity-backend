/**
 * Enum para los estados de pago
 * @description Define los posibles estados de un pago en el sistema
 */
export enum PaymentStatusEnum {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

/**
 * Enum para los métodos de pago
 * @description Define los métodos de pago aceptados en el sistema
 */
export enum PaymentMethodEnum {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  TRANSFER = 'TRANSFER',
  ONLINE = 'ONLINE',
}

/**
 * Enum para el proveedor que respalda el pago
 * @description MANUAL representa el flujo histórico (efectivo, transferencia,
 * tarjeta cobrada en el salón) donde un operador declara el estado. Cualquier
 * otro valor identifica una pasarela externa que es la única fuente de verdad
 * del estado del cobro.
 */
export enum PaymentProviderEnum {
  MANUAL = 'MANUAL',
  MERCADO_PAGO = 'MERCADO_PAGO',
}

/**
 * Datos con los que una pasarela actualiza el estado de un pago
 * @description El estado ya viene mapeado al dominio: la entidad nunca conoce
 * los estados crudos del proveedor. La traducción vive en el adapter de
 * infraestructura. `gatewayStatus` conserva el valor crudo solo como dato de
 * auditoría, para no perder distinciones que el dominio colapsa (por ejemplo
 * un contracargo, que se representa como REFUNDED).
 */
export interface ApplyGatewayStatusInput {
  /**
   * Estado interno destino, ya traducido desde el estado del proveedor
   */
  status: PaymentStatusEnum;

  /**
   * Estado crudo informado por el proveedor, tal cual llegó
   */
  gatewayStatus: string;

  /**
   * Identificador del pago en el proveedor, si todavía no estaba persistido
   */
  gatewayPaymentId?: string;

  /**
   * Motivo del rechazo informado por el proveedor
   */
  failureReason?: string;

  /**
   * Monto efectivamente reembolsado por el proveedor
   */
  refundedAmount?: number;

  /**
   * Identificador del reembolso en el proveedor
   */
  gatewayRefundId?: string;
}

/**
 * Resultado de aplicar un estado informado por la pasarela
 * @description `applied` hubo cambio de estado; `noop` el estado destino ya era
 * el actual (reintento del proveedor); `conflict` la transición es imposible y
 * se descartó sin modificar el estado. Ninguno lanza: el webhook debe poder
 * responder 200 en los tres casos.
 */
export type ApplyGatewayStatusResult = 'applied' | 'noop' | 'conflict';

/**
 * Transiciones de estado admitidas cuando la pasarela es la que informa
 * @description Solo avanza en el sentido del dinero. REFUNDED es terminal, y
 * ningún estado retrocede a PENDING: una notificación fuera de orden no puede
 * deshacer un cobro ya confirmado. FAILED puede pasar a COMPLETED porque el
 * estado se relee del proveedor, que es autoritativo: si informa que cobró, un
 * FAILED local es un dato viejo que hay que corregir.
 */
const GATEWAY_ALLOWED_TRANSITIONS: Readonly<
  Record<PaymentStatusEnum, readonly PaymentStatusEnum[]>
> = {
  [PaymentStatusEnum.PENDING]: [
    PaymentStatusEnum.COMPLETED,
    PaymentStatusEnum.FAILED,
    PaymentStatusEnum.REFUNDED,
  ],
  [PaymentStatusEnum.COMPLETED]: [PaymentStatusEnum.REFUNDED],
  [PaymentStatusEnum.FAILED]: [PaymentStatusEnum.COMPLETED, PaymentStatusEnum.REFUNDED],
  [PaymentStatusEnum.REFUNDED]: [],
};

/**
 * Interface para las propiedades del pago
 */
export interface PaymentProps {
  id: string;
  amount: number;
  status: PaymentStatusEnum;
  method: PaymentMethodEnum | null;
  paymentDate: Date | null;
  appointmentId: string;
  refundReason?: string;
  createdAt: Date;
  updatedAt: Date;

  // Integración con pasarela de pago. Todas opcionales: un pago manual no
  // tiene ninguna de estas propiedades y `provider` toma MANUAL por defecto.
  provider?: PaymentProviderEnum;
  gatewayPaymentId?: string;
  gatewayPreferenceId?: string;
  gatewayStatus?: string;
  idempotencyKey?: string;
  checkoutUrl?: string;
  refundedAmount?: number;
  gatewayRefundId?: string;
  failureReason?: string;
  lastSyncedAt?: Date;
}

/**
 * Entidad Payment
 * @description Representa un pago asociado a una cita en el sistema
 */
export class Payment {
  private readonly _id: string;
  private _amount: number;
  private _status: PaymentStatusEnum;
  private _method: PaymentMethodEnum | null;
  private _paymentDate: Date | null;
  private readonly _appointmentId: string;
  private _refundReason?: string;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private readonly _provider: PaymentProviderEnum;
  private _gatewayPaymentId?: string;
  private _gatewayPreferenceId?: string;
  private _gatewayStatus?: string;
  private readonly _idempotencyKey?: string;
  private _checkoutUrl?: string;
  private _refundedAmount?: number;
  private _gatewayRefundId?: string;
  private _failureReason?: string;
  private _lastSyncedAt?: Date;

  constructor(props: PaymentProps) {
    this._id = props.id;
    this._amount = props.amount;
    this._status = props.status;
    this._method = props.method;
    this._paymentDate = props.paymentDate;
    this._appointmentId = props.appointmentId;
    this._refundReason = props.refundReason;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
    // Sin provider explícito el pago es manual: es lo que corresponde a todas
    // las filas anteriores a la integración y al factory create().
    this._provider = props.provider ?? PaymentProviderEnum.MANUAL;
    this._gatewayPaymentId = props.gatewayPaymentId;
    this._gatewayPreferenceId = props.gatewayPreferenceId;
    this._gatewayStatus = props.gatewayStatus;
    this._idempotencyKey = props.idempotencyKey;
    this._checkoutUrl = props.checkoutUrl;
    this._refundedAmount = props.refundedAmount;
    this._gatewayRefundId = props.gatewayRefundId;
    this._failureReason = props.failureReason;
    this._lastSyncedAt = props.lastSyncedAt;
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get amount(): number {
    return this._amount;
  }

  get status(): PaymentStatusEnum {
    return this._status;
  }

  get method(): PaymentMethodEnum | null {
    return this._method;
  }

  get paymentDate(): Date | null {
    return this._paymentDate;
  }

  get appointmentId(): string {
    return this._appointmentId;
  }

  /**
   * Razón del reembolso (disponible solo si el pago fue reembolsado)
   */
  get refundReason(): string | undefined {
    return this._refundReason;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Proveedor que respalda el pago
   */
  get provider(): PaymentProviderEnum {
    return this._provider;
  }

  /**
   * Identificador del pago en la pasarela (disponible una vez que la pasarela
   * lo informó, por webhook o por sincronización manual)
   */
  get gatewayPaymentId(): string | undefined {
    return this._gatewayPaymentId;
  }

  /**
   * Identificador de la preferencia o intención de cobro creada en la pasarela
   */
  get gatewayPreferenceId(): string | undefined {
    return this._gatewayPreferenceId;
  }

  /**
   * Estado crudo informado por la pasarela, sin traducir al dominio
   */
  get gatewayStatus(): string | undefined {
    return this._gatewayStatus;
  }

  /**
   * Clave de idempotencia usada contra la pasarela
   * @description Es una credencial de deduplicación: no debe exponerse en
   * ninguna respuesta de la API.
   */
  get idempotencyKey(): string | undefined {
    return this._idempotencyKey;
  }

  /**
   * URL de checkout hospedado a la que se redirige al pagador
   */
  get checkoutUrl(): string | undefined {
    return this._checkoutUrl;
  }

  /**
   * Monto efectivamente reembolsado por la pasarela
   */
  get refundedAmount(): number | undefined {
    return this._refundedAmount;
  }

  /**
   * Identificador del reembolso en la pasarela
   */
  get gatewayRefundId(): string | undefined {
    return this._gatewayRefundId;
  }

  /**
   * Motivo del rechazo informado por la pasarela
   */
  get failureReason(): string | undefined {
    return this._failureReason;
  }

  /**
   * Momento de la última relectura del estado contra la pasarela
   */
  get lastSyncedAt(): Date | undefined {
    return this._lastSyncedAt;
  }

  /**
   * Verifica si el pago está completado
   */
  get isCompleted(): boolean {
    return this._status === PaymentStatusEnum.COMPLETED;
  }

  /**
   * Verifica si el pago está pendiente
   */
  get isPending(): boolean {
    return this._status === PaymentStatusEnum.PENDING;
  }

  /**
   * Verifica si el pago fue reembolsado
   */
  get isRefunded(): boolean {
    return this._status === PaymentStatusEnum.REFUNDED;
  }

  /**
   * Verifica si el pago falló
   */
  get isFailed(): boolean {
    return this._status === PaymentStatusEnum.FAILED;
  }

  /**
   * Verifica si el pago está respaldado por una pasarela externa
   * @description Un pago respaldado por pasarela no puede completarse,
   * cancelarse ni modificarse a mano: su estado lo determina el proveedor.
   */
  get isGatewayBacked(): boolean {
    return this._provider !== PaymentProviderEnum.MANUAL;
  }

  /**
   * Marca el pago como completado
   * @param method - Método de pago utilizado
   */
  markAsCompleted(method: PaymentMethodEnum): void {
    if (this._status !== PaymentStatusEnum.PENDING) {
      throw new Error('Only pending payments can be completed');
    }
    this._status = PaymentStatusEnum.COMPLETED;
    this._method = method;
    this._paymentDate = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Marca el pago como fallido
   */
  markAsFailed(): void {
    if (this._status !== PaymentStatusEnum.PENDING) {
      throw new Error('Only pending payments can be marked as failed');
    }
    this._status = PaymentStatusEnum.FAILED;
    this._updatedAt = new Date();
  }

  /**
   * Procesa un reembolso del pago
   * @param reason - Razón del reembolso (opcional)
   */
  refund(reason?: string): void {
    if (this._status !== PaymentStatusEnum.COMPLETED) {
      throw new Error('Only completed payments can be refunded');
    }
    this._status = PaymentStatusEnum.REFUNDED;
    if (reason) this._refundReason = reason;
    this._updatedAt = new Date();
  }

  /**
   * Actualiza el monto del pago
   * @param amount - Nuevo monto
   */
  updateAmount(amount: number): void {
    if (this._status !== PaymentStatusEnum.PENDING) {
      throw new Error('Only pending payments can be updated');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    this._amount = amount;
    this._updatedAt = new Date();
  }

  /**
   * Aplica el estado informado por la pasarela de forma idempotente
   * @description Es la contraparte de markAsCompleted/markAsFailed/refund para
   * el camino automático: nunca lanza, porque la pasarela reintenta por diseño
   * y un reintento sobre un pago ya resuelto no es un error. Los datos de
   * auditoría (estado crudo y lastSyncedAt) se refrescan siempre, incluso
   * cuando la transición no se aplica, para dejar registro de que se consultó.
   * @param input - Datos de la pasarela, con el estado ya mapeado al dominio
   * @returns 'applied' si cambió el estado, 'noop' si ya era el actual,
   * 'conflict' si la transición es imposible
   */
  applyGatewayStatus(input: ApplyGatewayStatusInput): ApplyGatewayStatusResult {
    this._gatewayStatus = input.gatewayStatus;
    this._lastSyncedAt = new Date();
    this._updatedAt = new Date();

    if (input.gatewayPaymentId) {
      this._gatewayPaymentId = input.gatewayPaymentId;
    }
    if (input.gatewayRefundId) {
      this._gatewayRefundId = input.gatewayRefundId;
    }
    if (input.refundedAmount !== undefined) {
      this._refundedAmount = input.refundedAmount;
    }

    if (input.status === this._status) {
      return 'noop';
    }

    if (!GATEWAY_ALLOWED_TRANSITIONS[this._status].includes(input.status)) {
      return 'conflict';
    }

    this._status = input.status;

    if (input.status === PaymentStatusEnum.COMPLETED) {
      this._method = PaymentMethodEnum.ONLINE;
      this._paymentDate = new Date();
      this._failureReason = undefined;
    }

    if (input.status === PaymentStatusEnum.FAILED) {
      this._failureReason = input.failureReason;
    }

    return 'applied';
  }

  /**
   * Convierte la entidad a un objeto plano
   * @description Deliberadamente NO expone los campos de pasarela. Hoy no tiene
   * ningún consumidor en `src/` (los DTO de respuesta se arman campo por campo
   * en cada caso de uso), así que extenderlo no aportaría nada y filtraría
   * idempotencyKey a cualquier consumidor futuro que lo serialice entero.
   */
  toObject(): PaymentProps {
    return {
      id: this._id,
      amount: this._amount,
      status: this._status,
      method: this._method,
      paymentDate: this._paymentDate,
      appointmentId: this._appointmentId,
      refundReason: this._refundReason,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }

  /**
   * Factory method para crear un nuevo pago
   */
  static create(
    id: string,
    amount: number,
    appointmentId: string,
  ): Payment {
    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    return new Payment({
      id,
      amount,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Factory method para crear un pago que se va a cobrar por una pasarela
   * @description El pago nace PENDING y se persiste antes de llamar al
   * proveedor, para que su id pueda viajar como referencia externa: así el
   * webhook siempre resuelve el pago local aunque todavía no se haya guardado
   * el identificador remoto.
   * @param id - ID del pago, que se usa como referencia externa en la pasarela
   * @param amount - Monto a cobrar, en unidad monetaria base
   * @param appointmentId - ID de la cita asociada
   * @param provider - Proveedor que va a procesar el cobro
   * @param idempotencyKey - Clave de idempotencia para evitar el doble cobro
   */
  static createForGateway(
    id: string,
    amount: number,
    appointmentId: string,
    provider: PaymentProviderEnum,
    idempotencyKey: string,
  ): Payment {
    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    if (provider === PaymentProviderEnum.MANUAL) {
      throw new Error('Gateway payments require a provider other than MANUAL');
    }
    if (!idempotencyKey) {
      throw new Error('Idempotency key is required for gateway payments');
    }

    return new Payment({
      id,
      amount,
      status: PaymentStatusEnum.PENDING,
      method: null,
      paymentDate: null,
      appointmentId,
      provider,
      idempotencyKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
