import request from 'supertest';
import app from '../../../src/app';
import { createTestUser } from '../../setup/helpers';

/**
 * Tests de integracion de forgot-password.
 *
 * El token de reset se expone como devToken en test (EXPOSE_VERIFICATION_TOKENS).
 * El rate limiter se auto-desactiva en test. Foco: anti-enumeracion.
 */
describe('Forgot Password Integration Tests', () => {
  describe('POST /api/v1/auth/forgot-password', () => {
    // Debería emitir un token de reset para un usuario existente
    it('should issue a reset token for an existing user', async () => {
      const user = await createTestUser('CLIENT');

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: user.email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.devToken).toBeDefined();
    });

    // Debería responder de forma idéntica para un email inexistente (anti-enumeración)
    it('should respond identically for a non-existent email', async () => {
      const user = await createTestUser('CLIENT');

      const existing = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: user.email });

      const missing = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: `ghost-${Date.now()}@example.com` });

      expect(missing.status).toBe(existing.status);
      expect(missing.body.message).toBe(existing.body.message);
      // El email inexistente no emite token
      expect(missing.body.devToken).toBeUndefined();
    });

    // Debería validar el formato del email
    it('should reject an invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
