import request from 'supertest';
import app from '../../../src/app';
import { loginTestUser } from '../../setup/helpers';

/**
 * Helper: POST /refresh-token con cookies y (opcional) header CSRF.
 * Si `csrfHeader` es undefined, no se envía el header (para probar el 403).
 */
const refresh = (cookies: string[], csrfHeader?: string) => {
  const req = request(app).post('/api/v1/auth/refresh-token').set('Cookie', cookies);
  return csrfHeader !== undefined ? req.set('X-CSRF-Token', csrfHeader) : req;
};

describe('Refresh Token Integration Tests (cookie httpOnly + CSRF)', () => {
  describe('POST /api/v1/auth/refresh-token', () => {
    // Rota y renueva con cookie de refresh válida + header CSRF correcto
    it('should rotate and refresh with a valid refresh cookie and CSRF header', async () => {
      const { refreshToken, csrfToken } = await loginTestUser();

      const response = await refresh(
        [`refreshToken=${refreshToken}`, `csrfToken=${csrfToken}`],
        csrfToken,
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBeDefined();
      // No debe exponer el refresh en el body
      expect(response.body.data).not.toHaveProperty('refreshToken');
      // Debe rotar: setea una nueva cookie de refresh
      const setCookie = response.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c) => c.startsWith('refreshToken='))).toBe(true);
    });

    // CSRF ausente -> 403
    it('should reject with 403 when the CSRF header is missing', async () => {
      const { refreshToken, csrfToken } = await loginTestUser();

      const response = await refresh([`refreshToken=${refreshToken}`, `csrfToken=${csrfToken}`]);

      expect(response.status).toBe(403);
    });

    // CSRF header != cookie -> 403
    it('should reject with 403 when the CSRF header does not match the cookie', async () => {
      const { refreshToken, csrfToken } = await loginTestUser();

      const response = await refresh(
        [`refreshToken=${refreshToken}`, `csrfToken=${csrfToken}`],
        'not-the-cookie-value',
      );

      expect(response.status).toBe(403);
    });

    // Sin cookie de refresh (CSRF ok) -> 401
    it('should reject with 401 when the refresh cookie is missing', async () => {
      const response = await refresh(['csrfToken=abc'], 'abc');

      expect(response.status).toBe(401);
    });

    // Refresh inexistente -> 401
    it('should reject with 401 for an invalid refresh token', async () => {
      const response = await refresh(['refreshToken=invalid-token', 'csrfToken=abc'], 'abc');

      expect(response.status).toBe(401);
    });

    // Reuse detection: reusar un token ya rotado -> 401
    it('should return 401 when reusing an already-rotated refresh token', async () => {
      const { refreshToken, csrfToken } = await loginTestUser();
      const cookies = [`refreshToken=${refreshToken}`, `csrfToken=${csrfToken}`];

      const first = await refresh(cookies, csrfToken);
      expect(first.status).toBe(200);

      const reuse = await refresh(cookies, csrfToken);
      expect(reuse.status).toBe(401);
    });

    // Concurrencia: dos refresh en paralelo con el mismo token -> uno gana (200),
    // el otro pierde la carrera y es rechazado (401). Valida la atomicidad del rotate.
    it('should handle concurrent refresh of the same token safely (only one wins)', async () => {
      const { refreshToken, csrfToken } = await loginTestUser();
      const cookies = [`refreshToken=${refreshToken}`, `csrfToken=${csrfToken}`];

      const [a, b] = await Promise.all([refresh(cookies, csrfToken), refresh(cookies, csrfToken)]);
      const statuses = [a.status, b.status].sort();

      expect(statuses).toEqual([200, 401]);
    });
  });
});
