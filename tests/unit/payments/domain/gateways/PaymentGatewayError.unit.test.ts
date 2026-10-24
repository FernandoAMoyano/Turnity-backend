import { PaymentGatewayError } from '../../../../../src/modules/payments/domain/gateways/PaymentGatewayError';

describe('PaymentGatewayError', () => {
  // Debería conservar el mensaje, el nombre y el status del proveedor
  it('should keep the message, the name and the provider status', () => {
    const error = new PaymentGatewayError('gateway failed', 502);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('gateway failed');
    expect(error.name).toBe('PaymentGatewayError');
    expect(error.providerStatus).toBe(502);
  });

  describe('isRetryable', () => {
    // Debería ser reintentable un error de red, sin status del proveedor
    it('should be retryable when there is no provider status', () => {
      expect(new PaymentGatewayError('network error').isRetryable).toBe(true);
    });

    // Debería ser reintentable un 5xx del proveedor
    it.each([500, 502, 503])('should be retryable on HTTP %i', (status) => {
      expect(new PaymentGatewayError('gateway failed', status).isRetryable).toBe(true);
    });

    // No debería ser reintentable un 4xx del proveedor
    it.each([400, 401, 403, 404])('should not be retryable on HTTP %i', (status) => {
      expect(new PaymentGatewayError('gateway failed', status).isRetryable).toBe(false);
    });
  });

  describe('isCredentialsError', () => {
    // Debería identificar un 401 o un 403 como error de credenciales
    it.each([401, 403])('should be a credentials error on HTTP %i', (status) => {
      expect(new PaymentGatewayError('gateway failed', status).isCredentialsError).toBe(true);
    });

    // No debería identificar como error de credenciales otros status ni un error de red
    it.each([400, 404, 500, undefined])('should not be a credentials error on %s', (status) => {
      expect(new PaymentGatewayError('gateway failed', status).isCredentialsError).toBe(false);
    });
  });
});
