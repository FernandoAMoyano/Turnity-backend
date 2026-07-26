import request from 'supertest';
import app from '../../../src/app';

/**
 * Tests de integracion del reenvio de verificacion.
 *
 * El rate limiter se auto-desactiva en NODE_ENV=test (igual que login/register),
 * por eso no se testea el 429 aca. El foco esta en la anti-enumeracion: misma
 * respuesta exista o no el email, y token emitido solo cuando corresponde.
 */
describe('Resend Verification Integration Tests', () => {
  const registerUnverified = async (): Promise<string> => {
    const email = `resend-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    await request(app).post('/api/v1/auth/register').send({
      name: 'Resend User',
      email,
      phone: '+1234567890',
      password: 'TestPass123!',
    });
    return email;
  };

  describe('POST /api/v1/auth/resend-verification', () => {
    // Debería reenviar la verificación a un usuario existente no verificado
    it('should resend verification for an existing unverified user', async () => {
      const email = await registerUnverified();

      const res = await request(app).post('/api/v1/auth/resend-verification').send({ email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Se emitió un token nuevo (expuesto en test)
      expect(res.body.devToken).toBeDefined();
    });

    // Debería responder de forma idéntica para un email inexistente (anti-enumeración)
    it('should respond identically for a non-existent email (no enumeration)', async () => {
      const existingEmail = await registerUnverified();

      const existing = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: existingEmail });

      const missing = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: `ghost-${Date.now()}@example.com` });

      // Mismo status y mismo mensaje: no se puede inferir si el email existe
      expect(missing.status).toBe(existing.status);
      expect(missing.body.message).toBe(existing.body.message);
      // El email inexistente no emite token
      expect(missing.body.devToken).toBeUndefined();
    });

    // No debería emitir token si el usuario ya está verificado
    it('should not issue a token if the user is already verified', async () => {
      const email = await registerUnverified();

      // Emitir + verificar primero
      const first = await request(app).post('/api/v1/auth/resend-verification').send({ email });
      await request(app).post('/api/v1/auth/verify-email').send({ token: first.body.devToken });

      const res = await request(app).post('/api/v1/auth/resend-verification').send({ email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Ya verificado -> no se emite ni expone token
      expect(res.body.devToken).toBeUndefined();
    });

    // Debería validar que el email tiene formato válido
    it('should reject an invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
