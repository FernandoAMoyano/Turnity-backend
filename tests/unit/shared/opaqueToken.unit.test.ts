import { generateOpaqueToken, hashToken } from '../../../src/shared/crypto/opaqueToken';

describe('opaqueToken', () => {
  describe('generateOpaqueToken', () => {
    // Debería generar tokens url-safe (base64url)
    it('should generate url-safe (base64url) tokens', () => {
      const token = generateOpaqueToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    // Debería generar un token distinto en cada llamada
    it('should generate a different token on each call', () => {
      expect(generateOpaqueToken()).not.toBe(generateOpaqueToken());
    });
  });

  describe('hashToken', () => {
    // Debería ser determinístico (mismo input -> mismo hash)
    it('should be deterministic (same input -> same hash)', () => {
      expect(hashToken('abc')).toBe(hashToken('abc'));
    });

    // Debería producir un SHA-256 hex de 64 caracteres distinto del input
    it('should produce a 64-char hex SHA-256 that differs from the input', () => {
      const hash = hashToken('some-opaque-token');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).not.toBe('some-opaque-token');
    });
  });
});
