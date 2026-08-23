import {
  IPaymentGateway,
  CreateCheckoutInput,
  GatewayCheckout,
  GatewayPaymentSnapshot,
  GatewayRefund,
  GatewayNotification,
  WebhookSignatureInput,
} from '../../../../src/modules/payments/domain/gateways/IPaymentGateway';

/**
 * Doble de prueba de `IPaymentGateway`, controlable desde el test
 * @description Primer doble compartido del repo: los `Fake*` existentes (ej.
 * `FakeVerificationTokenRepository`) se definen inline en el archivo de test
 * que los usa porque tienen un solo consumidor. Este se extrae a un archivo
 * propio lo usan (`CreateCheckout`, `HandleGatewayWebhook`, `RefundPayment`, etc.)
 *
 * Cada método registra sus llamadas (`*Calls`) para asserts de invocación, y
 * el resultado/error que devuelve es configurable por test seteando las
 * propiedades públicas antes de invocar el caso de uso bajo prueba.
 */
export class FakePaymentGateway implements IPaymentGateway {
  createCheckoutCalls: CreateCheckoutInput[] = [];
  getPaymentCalls: string[] = [];
  refundCalls: Array<{ gatewayPaymentId: string; idempotencyKey: string }> = [];

  checkoutResult: GatewayCheckout = {
    checkoutUrl: 'https://sandbox.mercadopago.com/checkout/fake',
    gatewayPreferenceId: 'fake-preference-id',
    expiresAt: new Date('2026-01-01T10:30:00Z'),
  };
  createCheckoutError: Error | null = null;

  /** Snapshots que `getPayment` devuelve, indexados por `gatewayPaymentId` */
  paymentSnapshots = new Map<string, GatewayPaymentSnapshot>();
  getPaymentError: Error | null = null;

  refundResult: GatewayRefund = {
    gatewayRefundId: 'fake-refund-id',
    amount: 0,
    status: 'approved',
  };
  refundError: Error | null = null;

  /** Resultado fijo que devuelve `verifyWebhookSignature` */
  signatureValid = true;

  /** Resultado fijo que devuelve `parseWebhookNotification` */
  notification: GatewayNotification | null = null;
  parseNotificationError: Error | null = null;

  /**
   * Registra la llamada y devuelve el resultado configurado
   * @param input - Datos de checkout recibidos; se guarda tal cual en `createCheckoutCalls`
   * @returns `checkoutResult`
   * @throws `createCheckoutError` si está seteado
   */
  async createCheckout(input: CreateCheckoutInput): Promise<GatewayCheckout> {
    this.createCheckoutCalls.push(input);
    if (this.createCheckoutError) {
      throw this.createCheckoutError;
    }
    return this.checkoutResult;
  }

  /**
   * Registra la llamada y devuelve el snapshot configurado
   * @param gatewayPaymentId - Id a buscar; se guarda tal cual en `getPaymentCalls`
   * @returns `paymentSnapshots.get(gatewayPaymentId)`, o `null` si no hay entrada para ese id
   * @throws `getPaymentError` si está seteado
   */
  async getPayment(gatewayPaymentId: string): Promise<GatewayPaymentSnapshot | null> {
    this.getPaymentCalls.push(gatewayPaymentId);
    if (this.getPaymentError) {
      throw this.getPaymentError;
    }
    return this.paymentSnapshots.get(gatewayPaymentId) ?? null;
  }

  /**
   * Registra la llamada y devuelve el resultado configurado
   * @param gatewayPaymentId - Id del pago a reembolsar; se guarda en `refundCalls`
   * @param idempotencyKey - Clave de idempotencia recibida; se guarda en `refundCalls`
   * @returns `refundResult`
   * @throws `refundError` si está seteado
   */
  async refund(gatewayPaymentId: string, idempotencyKey: string): Promise<GatewayRefund> {
    this.refundCalls.push({ gatewayPaymentId, idempotencyKey });
    if (this.refundError) {
      throw this.refundError;
    }
    return this.refundResult;
  }

  /**
   * Devuelve el resultado fijo configurado, sin inspeccionar el input
   * @param _input - Ignorado; el parámetro existe solo para cumplir la firma del puerto `IPaymentGateway`
   * @returns `signatureValid`
   */
  verifyWebhookSignature(_input: WebhookSignatureInput): boolean {
    return this.signatureValid;
  }

  /**
   * Devuelve la notificación configurada
   * @param _raw - Ignorado; el parámetro existe solo para cumplir la firma del puerto `IPaymentGateway`
   * @returns `notification`
   * @throws `parseNotificationError` si está seteado; también lanza un `Error` genérico si `notification`
   * quedó sin setear (evita que un fixture olvidado pase silenciosamente como `undefined`)
   */
  parseWebhookNotification(_raw: Buffer): GatewayNotification {
    if (this.parseNotificationError) {
      throw this.parseNotificationError;
    }
    if (!this.notification) {
      throw new Error('FakePaymentGateway.notification no fue seteado para este test');
    }
    return this.notification;
  }
}
