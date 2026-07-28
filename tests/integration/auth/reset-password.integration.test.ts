import request from 'supertest';
import app from '../../../src/app';
import { createTestUser, loginTestUser } from '../../setup/helpers';

/**
 * Tests de integracion de reset-password.
 *
 * El token de reset se obtiene via forgot-password (devToken expuesto en test).
 * Cubre: cambio efectivo de password, revocacion de sesiones, single-use,
 * token invalido y validacion de fuerza.
 */
describe('Reset Password Integration Tests', () => {
  const requestReset = async (email: string): Promise<string> => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email });
    return res.body.devToken as string;
  };

  describe('POST /api/v1/auth/reset-password', () => {
    // Debería resetear la password: la nueva funciona y la vieja no
    it('should reset the password (new works, old fails)', async () => {
      const user = await createTestUser('CLIENT'); // password inicial: TestPass123!
      const token = await requestReset(user.email);

      const reset = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'NewPass456!' });
      expect(reset.status).toBe(200);
      expect(reset.body.success).toBe(true);

      const newLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'NewPass456!' });
      expect(newLogin.status).toBe(200);

      const oldLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'TestPass123!' });
      expect(oldLogin.status).toBe(401);
    });

    // Debería revocar las sesiones activas al resetear
    it('should revoke active sessions on reset', async () => {
      const session = await loginTestUser(); // { token, refreshToken, csrfToken, user }
      const token = await requestReset(session.user.email);

      await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPass456!' });

      // La sesión previa quedó revocada: el refresh con la cookie vieja falla (401)
      const refresh = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', [
          `refreshToken=${session.refreshToken}`,
          `csrfToken=${session.csrfToken}`,
        ])
        .set('X-CSRF-Token', session.csrfToken as string);

      expect(refresh.status).toBe(401);
    });

    // Debería rechazar un token inválido
    it('should reject an invalid token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'this-is-not-a-real-token', password: 'NewPass456!' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    // Debería rechazar un token ya usado (single-use)
    it('should reject a token that was already used', async () => {
      const user = await createTestUser('CLIENT');
      const token = await requestReset(user.email);
      await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPass456!' });

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'AnotherPass789!' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    // Debería rechazar una password débil (regla de fuerza reutilizada)
    it('should reject a weak password', async () => {
      const user = await createTestUser('CLIENT');
      const token = await requestReset(user.email);

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, password: '123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    // Debería validar que el token es requerido
    it('should require the token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ password: 'NewPass456!' });

      expect(res.status).toBe(400);
    });
  });
});
