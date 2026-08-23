/**
 * Puerto de pasarela de pago
 * @description Declarado en `domain` junto a `IPaymentRepository`: mismo
 * patrón (dependencia externa expresada como interfaz que el dominio posee,
 * implementada en `infrastructure` e inyectada desde `PaymentContainer`).
 * Habla en tipos propios (`Gateway*`), nunca en tipos del SDK de Mercado Pago
 * ni en JSON crudo -- la traducción proveedor -> dominio vive completa en el
 * adapter (`MercadoPagoGateway`). Cero imports de infraestructura.
 */

/**
 * Datos necesarios para crear una intención de cobro
 */
export interface CreateCheckoutInput {
  /** ID del Payment local; se envía como `external_reference` a la pasarela */
  paymentId: string;
  /** Monto a cobrar, en la unidad monetaria base (coincide con Payment.amount) */
  amount: number;
  /** Descripción visible para el pagador en el checkout hospedado */
  description: string;
  /** Clave de idempotencia hacia la pasarela: evita crear una segunda intención */
  idempotencyKey: string;
}

/**
 * Intención de cobro creada en la pasarela
 */
export interface GatewayCheckout {
  /** URL de checkout hospedado a la que se redirige al pagador */
  checkoutUrl: string;
  /** Identificador de la preferencia/intención en la pasarela */
  gatewayPreferenceId: string;
  /** Vencimiento de la preferencia */
  expiresAt: Date;
}

/**
 * Estado de un pago tal como lo informa la pasarela
 * @description Se obtiene siempre re-fetcheando con el access token propio --
 * nunca se construye a partir del payload del webhook.
 */
export interface GatewayPaymentSnapshot {
  /** Identificador del pago en la pasarela */
  gatewayPaymentId: string;
  /**
   * Estado crudo informado por el proveedor (ej. "approved", "rejected").
   * Deliberadamente `string` y no un enum cerrado: es vocabulario que el
   * proveedor controla y puede extender sin aviso. Ver `PaymentStatusMapper`,
   * que es quien lo traduce a los cuatro estados internos.
   */
  status: string;
  /** Detalle del estado, cuando el proveedor lo informa (ej. razón de rechazo) */
  statusDetail?: string;
  /** `external_reference` enviado al crear la preferencia -- el `Payment.id` local */
  externalReference?: string;
  /** Monto informado por la pasarela, en unidad monetaria base */
  amount?: number;
  /** Monto reembolsado, si el pago tiene reembolsos aplicados */
  refundedAmount?: number;
  /** Momento en que la pasarela informó por última vez este estado */
  gatewayUpdatedAt?: Date;
}

/**
 * Resultado de ejecutar un reembolso contra la pasarela
 */
export interface GatewayRefund {
  /** Identificador del reembolso en la pasarela */
  gatewayRefundId: string;
  /** Monto efectivamente reembolsado */
  amount: number;
  /**
   * Estado del reembolso. `'approved'` ya se aplicó del lado de la pasarela;
   * `'pending'` puede resolverse más tarde (webhook o `/sync`).
   */
  status: 'approved' | 'pending';
}

/**
 * Notificación de webhook ya parseada, previa a la verificación de firma
 */
export interface GatewayNotification {
  /** Tipo de notificación informado por la pasarela (ej. "payment") */
  eventType: string;
  /** Identificador de la notificación en la pasarela -- clave de deduplicación */
  eventId: string;
  /** ID del recurso afectado (ej. el `data.id` del pago) */
  resourceId: string;
}

/**
 * Datos para verificar la firma de una notificación de webhook
 * @description Los tres campos llegan tal cual del request, sin normalizar --
 * la normalización (ej. minúsculas en `dataId`) es responsabilidad del
 * adapter, porque es un detalle específico del formato de firma de MP.
 */
export interface WebhookSignatureInput {
  /** Header `x-signature` tal como llegó */
  xSignature: string | undefined;
  /** Header `x-request-id` tal como llegó */
  xRequestId: string | undefined;
  /** `data.id` de la query string, tal como llegó */
  dataId: string | undefined;
}

/**
 * Puerto de pasarela de pago
 * @description Tres implementaciones: `MercadoPagoGateway` (producción y
 * sandbox, misma clase, distinto access token), `NoopPaymentGateway` (activa
 * sin credenciales, mantiene el proyecto arrancable) y `FakePaymentGateway`
 * (solo en tests, controlable desde el test).
 */
export interface IPaymentGateway {
  /**
   * Crea una intención de cobro (preferencia) en la pasarela
   * @param input - Datos para armar la intención de cobro (tipo
   * `CreateCheckoutInput`; cada campo -- `paymentId`, `amount`, `description`,
   * `idempotencyKey` -- está documentado en su propia declaración más arriba
   * en este archivo).
   * @returns La intención de cobro creada (tipo `GatewayCheckout`): URL de
   * checkout hospedado, id de la preferencia en la pasarela y vencimiento.
   * @throws Error si la pasarela responde con un error al crear la
   * preferencia.
   */
  createCheckout(input: CreateCheckoutInput): Promise<GatewayCheckout>;

  /**
   * Re-fetchea el estado autoritativo de un pago desde la pasarela
   * @description Nunca se confía en el payload del webhook:
   * todo cambio de estado se aplica solo después de re-consultar este método
   * con el access token propio.
   * @param gatewayPaymentId - Identificador del pago en la pasarela
   * (`string`); el mismo valor persistido en `Payment.gatewayPaymentId`, o el
   * `resourceId` que devuelve `parseWebhookNotification` cuando todavía no
   * hay `Payment` local para esa notificación.
   * @returns El snapshot (tipo `GatewayPaymentSnapshot`), o `null` si la
   * pasarela no reconoce el id (nunca lanza una excepción en ese caso).
   * @throws Error si la respuesta de la pasarela no es exitosa y tampoco
   * indica "no encontrado".
   */
  getPayment(gatewayPaymentId: string): Promise<GatewayPaymentSnapshot | null>;

  /**
   * Ejecuta un reembolso contra la pasarela
   * @param gatewayPaymentId - Identificador del pago a reembolsar en la
   * pasarela (`string`); el mismo valor persistido en
   * `Payment.gatewayPaymentId`.
   * @param idempotencyKey - Evita un doble reembolso ante un reintento
   * (`string`); la arma el caso de uso que ejecuta el reembolso.
   * @returns El reembolso ejecutado (tipo `GatewayRefund`).
   * @throws Error si la pasarela responde con un error al crear el
   * reembolso.
   */
  refund(gatewayPaymentId: string, idempotencyKey: string): Promise<GatewayRefund>;

  /**
   * Verifica la firma de una notificación de webhook
   * @description Es la única barrera de un endpoint público sin auth: nunca
   * lanza una excepción, siempre devuelve un booleano, incluso ante headers ausentes o
   * malformados.
   * @param input - Datos crudos del request, sin normalizar (tipo
   * `WebhookSignatureInput`; cada campo -- `xSignature`, `xRequestId`,
   * `dataId` -- está documentado en su propia declaración más arriba en este
   * archivo).
   * @returns `true` solo si la firma es válida según el algoritmo propio de
   * cada proveedor; `false` en cualquier otro caso.
   */
  verifyWebhookSignature(input: WebhookSignatureInput): boolean;

  /**
   * Parsea el body crudo de una notificación de webhook
   * @param raw - Body tal como llegó, sin tocar por ningún body-parser
   * (`Buffer`).
   * @returns La notificación ya parseada (tipo `GatewayNotification`).
   * @throws Error si el body no es JSON válido o le faltan campos
   * requeridos.
   */
  parseWebhookNotification(raw: Buffer): GatewayNotification;
}
