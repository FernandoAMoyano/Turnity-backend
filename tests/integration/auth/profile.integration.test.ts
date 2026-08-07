import request from 'supertest';
import app from '../../../src/app';

/**
 * Helper: registra un CLIENT, verifica su email (gating de login activo en test,
 * usando el devToken expuesto) y loguea. Devuelve el token y el email.
 */
const registerVerifiedAndLogin = async (name: string, emailPrefix: string) => {
  const email = `${emailPrefix}-${Date.now()}@example.com`;

  const registerResponse = await request(app).post('/api/v1/auth/register').send({
    name,
    email,
    phone: '+1234567890',
    password: 'TestPass123!',
    roleName: 'CLIENT',
  });
  expect(registerResponse.status).toBe(201);

  await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ token: registerResponse.body.devToken });

  const loginResponse = await request(app).post('/api/v1/auth/login').send({
    email,
    password: 'TestPass123!',
  });
  expect(loginResponse.status).toBe(200);

  return { token: loginResponse.body.data.token as string, email };
};

describe('Profile Integration Tests', () => {
  describe('GET /api/v1/auth/profile', () => {
    // Debería obtener el perfil del usuario con token válido
    it('should get user profile with valid token', async () => {
      const { token, email } = await registerVerifiedAndLogin('Profile Test User', 'profile-test');

      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe(email);
      expect(response.body.data.name).toBe('Profile Test User');
      expect(response.body.data.role.name).toBe('CLIENT');
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('phone');
      expect(response.body.data).toHaveProperty('createdAt');
      expect(response.body.data).toHaveProperty('updatedAt');
      // Regresion: mismo bug que en registro -- preferences no debia desaparecer
      // de la respuesta JSON al pasar por PrismaUserRepository.findById()
      expect(response.body.data).toHaveProperty('preferences');
      expect(response.body.data.preferences).toBeNull();
    });

    // Debería rechazar el acceso sin token
    it('should reject access without token', async () => {
      const response = await request(app).get('/api/v1/auth/profile');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    // Debería rechazar el acceso con token inválido
    it('should reject access with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/auth/profile', () => {
    // Debería actualizar el perfil del usuario exitosamente
    it('should update user profile successfully', async () => {
      const { token, email } = await registerVerifiedAndLogin('Update Test User', 'update-test');

      const updateData = {
        name: 'Updated Name',
        phone: '+9876543210',
      };

      const updateResponse = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(updateData);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);
      expect(updateResponse.body.data.name).toBe('Updated Name');
      expect(updateResponse.body.data.phone).toBe('+9876543210');
      expect(updateResponse.body.data.email).toBe(email);
    });

    // Debería obtener el perfil actualizado después de la actualización
    it('should get updated profile after update', async () => {
      const { token } = await registerVerifiedAndLogin('Get Updated Test User', 'get-updated');

      await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Finally Updated Name',
          phone: '+9876543210',
        });

      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Finally Updated Name');
      expect(response.body.data.phone).toBe('+9876543210');
    });

    // Debería actualizar el perfil con datos parciales
    it('should update profile with partial data', async () => {
      const { token } = await registerVerifiedAndLogin('Partial Test User', 'partial');

      const response = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Partial Update Name',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Partial Update Name');
    });

    // Debería rechazar la actualización del perfil sin token
    it('should reject profile update without token', async () => {
      const response = await request(app).put('/api/v1/auth/profile').send({
        name: 'Should Fail',
      });

      expect(response.status).toBe(401);
    });

    // Debería rechazar la actualización del perfil con datos inválidos
    it('should reject profile update with invalid data', async () => {
      const { token } = await registerVerifiedAndLogin('Invalid Test User', 'invalid');

      const response = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '',
          phone: 'invalid-phone',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
