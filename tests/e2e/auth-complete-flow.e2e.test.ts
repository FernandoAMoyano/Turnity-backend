import request from 'supertest';
import app from '../../src/app';
import { createTestUser } from '../setup/helpers';

describe('Auth Complete Flow E2E Tests', () => {
  // Debería completar el flujo completo de autenticación
  it('should complete full authentication flow', async () => {
    // 1. Registrar usuario (usará roleId del seed)
    const userData = await createTestUser('CLIENT');

    // 2. Login
    const loginResponse = await request(app).post('/api/v1/auth/login').send({
      email: userData.email,
      password: 'TestPass123!',
    });

    expect(loginResponse.status).toBe(200);
    const { token } = loginResponse.body.data;
    expect(token).toBeDefined();

    // El refresh y el CSRF viajan por cookie (F5b)
    const setCookie = loginResponse.headers['set-cookie'] as unknown as string[];
    const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='))!.split(';')[0];
    const csrfCookie = setCookie.find((c) => c.startsWith('csrfToken='))!.split(';')[0];
    const csrfValue = csrfCookie.split('=')[1];
    expect(refreshCookie).toBeDefined();

    // 3. Obtener perfil
    const profileResponse = await request(app)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.data.email).toBe(userData.email);

    // 4. Refresh token (cookie httpOnly + header CSRF)
    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', [refreshCookie, csrfCookie])
      .set('X-CSRF-Token', csrfValue);

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.data.token).toBeDefined();
  });

  // Debería manejar escenarios completos de error
  it('should handle complete error scenarios', async () => {
    // Test con credenciales inválidas
    const loginResponse = await request(app).post('/api/v1/auth/login').send({
      email: 'invalid@example.com',
      password: 'wrongpassword',
    });

    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body.success).toBe(false);
  });
});
