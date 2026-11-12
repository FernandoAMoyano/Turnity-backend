import { toPaymentResponseDto } from '../../../../../src/modules/payments/application/mappers/toPaymentResponseDto';
import {
  Payment,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';

describe('toPaymentResponseDto', () => {
  const appointmentId = '123e4567-e89b-12d3-a456-426614174001';

  const gatewayPayment = (): Payment =>
    Payment.createForGateway(
      '123e4567-e89b-12d3-a456-426614174000',
      85,
      appointmentId,
      PaymentProviderEnum.MERCADO_PAGO,
      '123e4567-e89b-12d3-a456-426614174777',
    );

  // Debería informar MANUAL y omitir los datos de checkout en un pago manual
  it('should report MANUAL and leave the checkout data out for a manual payment', () => {
    const payment = Payment.create('123e4567-e89b-12d3-a456-426614174002', 85, appointmentId);

    const dto = toPaymentResponseDto(payment);

    expect(dto.provider).toBe(PaymentProviderEnum.MANUAL);
    expect(dto.checkoutUrl).toBeUndefined();
    expect(dto.checkoutExpiresAt).toBeUndefined();
  });

  // Debería devolver la URL y el vencimiento informado por la pasarela
  it('should return the checkout URL and the expiration reported by the gateway', () => {
    const payment = gatewayPayment();
    const expiresAt = new Date('2026-11-12T18:30:00Z');
    payment.recordCheckoutCreated('https://example.com/checkout', 'preference-id', expiresAt);

    const dto = toPaymentResponseDto(payment);

    expect(dto.provider).toBe(PaymentProviderEnum.MERCADO_PAGO);
    expect(dto.checkoutUrl).toBe('https://example.com/checkout');
    expect(dto.checkoutExpiresAt).toEqual(expiresAt);
  });

  // Debería devolver el vencimiento por defecto cuando la pasarela no informó uno
  it('should return the default expiration when the gateway did not report one', () => {
    const payment = gatewayPayment();
    payment.recordCheckoutCreated('https://example.com/checkout', 'preference-id');

    const dto = toPaymentResponseDto(payment);

    expect(dto.checkoutExpiresAt).toEqual(new Date(payment.createdAt.getTime() + 30 * 60_000));
  });

  // Debería omitir el vencimiento y devolver el motivo cuando el checkout no se pudo crear
  it('should leave the expiration out and return the reason when the checkout could not be created', () => {
    const payment = gatewayPayment();
    payment.markAsFailed('The payment gateway rejected the checkout creation.');

    const dto = toPaymentResponseDto(payment);

    expect(dto.checkoutUrl).toBeUndefined();
    expect(dto.checkoutExpiresAt).toBeUndefined();
    expect(dto.failureReason).toBe('The payment gateway rejected the checkout creation.');
  });

  // No debería exponer la clave de idempotencia
  it('should never expose the idempotency key', () => {
    const payment = gatewayPayment();
    payment.recordCheckoutCreated('https://example.com/checkout', 'preference-id');

    const dto = toPaymentResponseDto(payment);

    expect(dto).not.toHaveProperty('idempotencyKey');
    expect(Object.values(dto)).not.toContain('123e4567-e89b-12d3-a456-426614174777');
  });
});
