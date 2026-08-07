import request from 'supertest';
import app from '../../../src/app';
import { testPrisma } from '../../setup/database';

/**
 * Tests de integracion de verificacion de email.
 *
 * El token de verificacion se obtiene del campo devToken de la respuesta de
 * /register, que solo se expone en test/dev con EXPOSE_VERIFICATION_TOKENS=true
 * (forzado en jest.setup.ts). En test no se envian mails reales (jsonTransport).
 */
describe('Verify Email Integration Tests', () => {
  const registerUser = async () => {
    const email = `verify-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Verify User',
      email,
      phone: '+1234567890',
      password: 'TestPass123!',
    });
    return res.body; // { success, data, message, devToken }
  };

  describe('POST /api/v1/auth/verify-email', () => {
    // Debería exponer el token de verificación en el registro (test/dev)
    it('should expose the verification token on register (dev/test)', async () => {
      const body = await registerUser();
      expect(body.devToken).toBeDefined();
      expect(typeof body.devToken).toBe('string');
    });

    // Debería verificar el email con un token válido y marcarlo como verificado
    it('should verify the email with a valid token', async () => {
      const body = await registerUser();

      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: body.devToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const user = await testPrisma.user.findUnique({ where: { id: body.data.id } });
      expect(user?.emailVerified).toBe(true);
      expect(user?.emailVerifiedAt).not.toBeNull();
    });

    // Debería rechazar un token ya usado (single-use)
    it('should reject a token that was already used', async () => {
      const body = await registerUser();
      await request(app).post('/api/v1/auth/verify-email').send({ token: body.devToken });

      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: body.devToken });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    // Debería rechazar un token inexistente/inválido
    it('should reject an invalid token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: 'this-is-not-a-real-token' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    // Debería validar que el token es requerido
    it('should require the token', async () => {
      const res = await request(app).post('/api/v1/auth/verify-email').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
