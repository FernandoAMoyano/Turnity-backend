import request from 'supertest';
import app from '../../src/app';

describe('Health & Readiness Integration Tests', () => {
  describe('GET /health', () => {
    // Debería responder 200 sin depender de la base de datos
    it('should respond 200 without depending on the database', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Turnity API is running');
    });
  });

  describe('GET /ready', () => {
    // Debería responder 200 cuando la base de datos esta disponible
    it('should respond 200 when the database is available', async () => {
      const response = await request(app).get('/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        checks: { database: 'up' },
      });
    });
  });
});
