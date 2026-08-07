import request from 'supertest';
import app from '../../../src/app';

describe('Login Integration Tests', () => {
  describe('POST /api/v1/auth/login', () => {
    // Debería iniciar sesión con credenciales válidas
    it('should login with valid credentials', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'admin@turnity.com',
        password: 'admin123',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');
      // El refresh ya no viaja en el body, sino en cookie httpOnly (F5b)
      expect(response.body.data).not.toHaveProperty('refreshToken');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.email).toBe('admin@turnity.com');
      expect(response.body.data.user.role.name).toBe('ADMIN');

      const setCookie = response.headers['set-cookie'] as unknown as string[];
      const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='));
      const csrfCookie = setCookie.find((c) => c.startsWith('csrfToken='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(csrfCookie).toBeDefined();
    });

    // Debería rechazar credenciales inválidas
    it('should reject invalid credentials', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'admin@turnity.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid credentials');
    });

    // Debería validar el formato del email
    it('should validate email format', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'invalid-email',
        password: 'admin123',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid email format');
    });

    // Debería rechazar email vacío
    it('should reject empty email', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: '',
        password: 'admin123',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar contraseña vacía
    it('should reject empty password', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'admin@turnity.com',
        password: '',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar inicio de sesión para usuario inexistente
    it('should reject login for non-existent user', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'nonexistent@turnity.com',
        password: 'admin123',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
