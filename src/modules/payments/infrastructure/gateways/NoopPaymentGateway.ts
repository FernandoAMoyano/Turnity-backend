import {
  IPaymentGateway,
  CreateCheckoutInput,
  GatewayCheckout,
  GatewayPaymentSnapshot,
  GatewayRefund,
  GatewayNotification,
  WebhookSignatureInput,
} from '../../domain/gateways/IPaymentGateway';
import { BusinessRuleError } from '../../../../shared/exceptions/BusinessRuleError';

/**
 * Implementación inerte del puerto de pasarela
 * @description Activa cuando `PAYMENT_GATEWAY_PROVIDER=none`. Es lo que
 * mantiene el proyecto arrancable sin credenciales -- dev, CI, cualquiera que
 * clone el repo (2.3 del plan). `createCheckout` y `refund` fallan con
 * `BusinessRuleError` (422: es una regla de negocio -- "no hay pasarela
 * configurada" -- no un error técnico). `verifyWebhookSignature` devuelve
 * `false` siempre, así que el endpoint de webhook queda inerte (401) sin
 * credenciales. `getPayment` devuelve `null`: no hay nada que re-fetchear.
 */
export class NoopPaymentGateway implements IPaymentGateway {
  /**
   * No crea ninguna intención de cobro: la pasarela no está configurada
   * @param _input - Ignorado (tipo `CreateCheckoutInput`, declarado en
   * `IPaymentGateway.ts`); el parámetro existe solo para cumplir la firma del
   * puerto `IPaymentGateway`, nunca se lee.
   * @throws BusinessRuleError - Siempre. "No hay pasarela configurada" es una
   * regla de negocio (se traduce a HTTP 422 en el error handler), no un error
   * técnico -- por eso `BusinessRuleError` y no `Error`.
   */
  async createCheckout(_input: CreateCheckoutInput): Promise<GatewayCheckout> {
    throw new BusinessRuleError('Payment gateway is not configured');
  }

  /**
   * No hay pago que re-fetchear: la pasarela no está configurada
   * @param _gatewayPaymentId - Ignorado (`string`); el parámetro existe solo
   * para cumplir la firma del puerto `IPaymentGateway`, nunca se lee.
   * @returns `null` siempre -- mismo valor que devolvería un `getPayment` real
   * ante un id que la pasarela no reconoce, así que el caller no necesita
   * distinguir "sin pasarela" de "pago no encontrado".
   */
  async getPayment(_gatewayPaymentId: string): Promise<GatewayPaymentSnapshot | null> {
    return null;
  }

  /**
   * No ejecuta ningún reembolso: la pasarela no está configurada
   * @param _gatewayPaymentId - Ignorado (`string`); el parámetro existe solo
   * para cumplir la firma del puerto `IPaymentGateway`, nunca se lee.
   * @param _idempotencyKey - Ignorado (`string`); el parámetro existe solo
   * para cumplir la firma del puerto `IPaymentGateway`, nunca se lee.
   * @throws BusinessRuleError - Siempre, mismo motivo que `createCheckout`.
   */
  async refund(_gatewayPaymentId: string, _idempotencyKey: string): Promise<GatewayRefund> {
    throw new BusinessRuleError('Payment gateway is not configured');
  }

  /**
   * Ninguna firma resulta válida: sin credenciales no hay `webhookSecret`
   * contra el cual verificar, así que el endpoint de webhook queda inerte
   * (responde 401 a cualquier notificación mientras la pasarela no esté
   * configurada)
   * @param _input - Ignorado (tipo `WebhookSignatureInput`, declarado en
   * `IPaymentGateway.ts`); el parámetro existe solo para cumplir la firma del
   * puerto `IPaymentGateway`, nunca se lee.
   * @returns `false` siempre.
   */
  verifyWebhookSignature(_input: WebhookSignatureInput): boolean {
    return false;
  }

  /**
   * No parsea ninguna notificación: la pasarela no está configurada
   * @param _raw - Ignorado (`Buffer`); el parámetro existe solo para cumplir
   * la firma del puerto `IPaymentGateway`, nunca se lee.
   * @throws BusinessRuleError - Siempre, mismo motivo que `createCheckout`.
   */
  parseWebhookNotification(_raw: Buffer): GatewayNotification {
    throw new BusinessRuleError('Payment gateway is not configured');
  }
}
