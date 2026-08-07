import request from 'supertest';
import app from '../../../src/app';

/**
 * Tests del gating de login por email no verificado (REQUIRE_EMAIL_VERIFICATION).
 *
 * En test el flag esta activo, asi que un usuario recien registrado (sin verificar)
 * no puede loguear hasta confirmar su email. Estos tests registran directo (sin el
 * helper createTestUser, que ya verifica) para ejercitar el camino sin verificar.
 */
describe('Login Email Verification Gating', () => {
  const registerRaw = async () => {
    const email = `gating-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Gating User',
      email,
      phone: '+1234567890',
      password: 'TestPass123!',
    });
    return { email, devToken: res.body.devToken as string };
  };

  describe('POST /api/v1/auth/login (unverified)', () => {
    // Debería bloquear el login con 403 si el email no está verificado
    it('should block login with 403 when the email is not verified', async () => {
      const { email } = await registerRaw();

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'TestPass123!' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    // Debería permitir el login luego de verificar el email
    it('should allow login after verifying the email', async () => {
      const { email, devToken } = await registerRaw();

      await request(app).post('/api/v1/auth/verify-email').send({ token: devToken });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'TestPass123!' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('token');
    });

    // Debería devolver 401 (no 403) con password incorrecta, aun sin verificar:
    // las credenciales se validan ANTES del chequeo de verificación
    it('should return 401 (not 403) for a wrong password on an unverified user', async () => {
      const { email } = await registerRaw();

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPass123!' });

      expect(res.status).toBe(401);
    });
  });
});
