import { NoopPaymentGateway } from '../../../../../src/modules/payments/infrastructure/gateways/NoopPaymentGateway';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';

describe('NoopPaymentGateway', () => {
  // Debería rechazar la creación de checkout con BusinessRuleError
  it('should reject createCheckout with BusinessRuleError', async () => {
    const gateway = new NoopPaymentGateway();

    await expect(
      gateway.createCheckout({
        paymentId: 'payment-1',
        amount: 100,
        description: 'Turno',
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  // Debería devolver null en getPayment: no hay nada que re-fetchear
  it('should return null from getPayment', async () => {
    const gateway = new NoopPaymentGateway();

    await expect(gateway.getPayment('any-id')).resolves.toBeNull();
  });

  // Debería rechazar el reembolso con BusinessRuleError
  it('should reject refund with BusinessRuleError', async () => {
    const gateway = new NoopPaymentGateway();

    await expect(gateway.refund('any-id', 'idem-1')).rejects.toThrow(BusinessRuleError);
  });

  // Debería devolver siempre false en verifyWebhookSignature, sin lanzar
  it('should always return false from verifyWebhookSignature without throwing', () => {
    const gateway = new NoopPaymentGateway();

    expect(() =>
      gateway.verifyWebhookSignature({ xSignature: undefined, xRequestId: undefined, dataId: undefined }),
    ).not.toThrow();
    expect(
      gateway.verifyWebhookSignature({
        xSignature: 'ts=1,v1=deadbeef',
        xRequestId: 'req-1',
        dataId: 'data-1',
      }),
    ).toBe(false);
  });

  // Debería rechazar el parseo de notificaciones con BusinessRuleError
  it('should reject parseWebhookNotification with BusinessRuleError', () => {
    const gateway = new NoopPaymentGateway();

    expect(() => gateway.parseWebhookNotification(Buffer.from('{}'))).toThrow(BusinessRuleError);
  });
});
