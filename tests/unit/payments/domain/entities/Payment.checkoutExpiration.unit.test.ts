import {
  Payment,
  PaymentProps,
  PaymentStatusEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';

describe('Payment Entity - Vencimiento del checkout', () => {
  const createdAt = new Date('2026-01-01T10:00:00Z');

  // Pago de pasarela PENDING sin vencimiento registrado
  const gatewayPaymentProps: PaymentProps = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    amount: 1500.5,
    status: PaymentStatusEnum.PENDING,
    method: null,
    paymentDate: null,
    appointmentId: '123e4567-e89b-12d3-a456-426614174001',
    provider: PaymentProviderEnum.MERCADO_PAGO,
    idempotencyKey: '123e4567-e89b-12d3-a456-426614174002',
    createdAt,
    updatedAt: createdAt,
  };

  const minutesAfter = (date: Date, minutes: number): Date =>
    new Date(date.getTime() + minutes * 60_000);

  describe('recordCheckoutCreated', () => {
    // Debería guardar el vencimiento informado por la pasarela
    it('should store the expiration reported by the gateway', () => {
      const payment = new Payment(gatewayPaymentProps);
      const expiresAt = minutesAfter(createdAt, 30);

      payment.recordCheckoutCreated('https://checkout.example/abc', 'pref-1', expiresAt);

      expect(payment.checkoutExpiresAt).toEqual(expiresAt);
    });

    // Debería dejar el vencimiento sin valor cuando no se informa
    it('should leave the expiration undefined when it is not provided', () => {
      const payment = new Payment(gatewayPaymentProps);

      payment.recordCheckoutCreated('https://checkout.example/abc', 'pref-1');

      expect(payment.checkoutExpiresAt).toBeUndefined();
    });
  });

  describe('hasCheckoutExpired', () => {
    // Debería usar el vencimiento registrado más el margen de espera
    it('should use the stored expiration plus the grace period', () => {
      const expiresAt = minutesAfter(createdAt, 60);
      const payment = new Payment({ ...gatewayPaymentProps, checkoutExpiresAt: expiresAt });

      expect(payment.hasCheckoutExpired(minutesAfter(expiresAt, 4))).toBe(false);
      expect(payment.hasCheckoutExpired(minutesAfter(expiresAt, 5))).toBe(false);
      expect(payment.hasCheckoutExpired(minutesAfter(expiresAt, 6))).toBe(true);
    });

    // Debería contar 30 minutos desde la creación cuando no hay vencimiento registrado
    it('should count 30 minutes from creation when no expiration is stored', () => {
      const payment = new Payment(gatewayPaymentProps);

      expect(payment.hasCheckoutExpired(minutesAfter(createdAt, 35))).toBe(false);
      expect(payment.hasCheckoutExpired(minutesAfter(createdAt, 36))).toBe(true);
    });

    // Debería devolver false para un pago de pasarela que ya no está PENDING
    it.each([PaymentStatusEnum.COMPLETED, PaymentStatusEnum.FAILED, PaymentStatusEnum.REFUNDED])(
      'should return false for a gateway payment in status %s',
      (status) => {
        const payment = new Payment({ ...gatewayPaymentProps, status });

        expect(payment.hasCheckoutExpired(minutesAfter(createdAt, 120))).toBe(false);
      },
    );

    // Debería devolver false para un pago manual
    it('should return false for a manual payment', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        provider: PaymentProviderEnum.MANUAL,
        idempotencyKey: undefined,
      });

      expect(payment.hasCheckoutExpired(minutesAfter(createdAt, 120))).toBe(false);
    });
  });
});
