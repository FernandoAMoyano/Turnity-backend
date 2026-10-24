import { translateGatewayFailure } from '../../../../../src/modules/payments/application/errors/translateGatewayFailure';
import { PaymentGatewayError } from '../../../../../src/modules/payments/domain/gateways/PaymentGatewayError';
import { AppError } from '../../../../../src/shared/exceptions/AppError';
import { BusinessRuleError } from '../../../../../src/shared/exceptions/BusinessRuleError';

describe('translateGatewayFailure', () => {
  const messages = {
    retryable: 'The gateway failed. Please try again later.',
    rejected: 'The gateway rejected the request.',
  };

  // Debería devolver tal cual un AppError, como el de la pasarela sin configurar
  it('should return an AppError as is, like the one for an unconfigured gateway', () => {
    const error = new BusinessRuleError('Payment gateway is not configured');

    expect(translateGatewayFailure(error, messages)).toBe(error);
  });

  // Debería responder con el mensaje de credenciales ante un 401 o un 403
  it.each([401, 403])('should use the credentials message on HTTP %i', (status) => {
    const result = translateGatewayFailure(new PaymentGatewayError('failed', status), messages);

    expect(result).toBeInstanceOf(AppError);
    expect(result.statusCode).toBe(502);
    expect(result.code).toBe('BUSINESS_RULE_ERROR');
    expect(result.message).toBe(
      'The payment gateway rejected the credentials configured on this server. Check the payment gateway configuration.',
    );
  });

  // Debería usar el mensaje de rechazo ante otro 4xx
  it.each([400, 404, 422])('should use the rejected message on HTTP %i', (status) => {
    const result = translateGatewayFailure(new PaymentGatewayError('failed', status), messages);

    expect(result.statusCode).toBe(502);
    expect(result.message).toBe(messages.rejected);
  });

  // Debería usar el mensaje de reintento ante un 5xx o un error de red
  it.each([500, 503, undefined])('should use the retryable message on %s', (status) => {
    const result = translateGatewayFailure(new PaymentGatewayError('failed', status), messages);

    expect(result.statusCode).toBe(502);
    expect(result.message).toBe(messages.retryable);
  });

  // Debería tratar como pasajero un error que no es de la pasarela
  it.each([new Error('unexpected'), 'plain string rejection'])(
    'should treat an unknown failure as retryable: %s',
    (error) => {
      const result = translateGatewayFailure(error, messages);

      expect(result.statusCode).toBe(502);
      expect(result.message).toBe(messages.retryable);
    },
  );
});
