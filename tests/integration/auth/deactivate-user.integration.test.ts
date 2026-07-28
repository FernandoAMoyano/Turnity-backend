import request from 'supertest';
import app from '../../../src/app';
import { loginAsAdmin } from '../../setup/helpers';
import { generateUuid } from '../../../src/shared/utils/uuid';

// Tests de integración para PATCH /auth/users/:id/deactivate (F11)
// Antes de este fix, este endpoint no tenía ningún test HTTP -- solo cobertura unitaria
// del use case DeactivateUser. Cubre además la validación de :id agregada en F11
// (AuthValidations.deactivateUser + ValidationMiddleware en la ruta).
describe('Deactivate User Integration Tests (F11)', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
  });

  const registerClient = async (emailPrefix: string) => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'F11 Deactivate Test User',
        email: `${emailPrefix}-${Date.now()}@example.com`,
        phone: '+1234567890',
        password: 'TestPass123!',
        roleName: 'CLIENT',
      });

    expect(response.status).toBe(201);

    // Verificar email (gating de login): permite loguear a estos usuarios cuando
    // el test lo necesita. Inofensivo para los que solo son desactivados por admin.
    if (response.body.devToken) {
      await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: response.body.devToken });
    }

    return response.body.data;
  };

  // Debería desactivar un usuario activo como ADMIN
  it('should deactivate an active user as ADMIN', async () => {
    const user = await registerClient('deactivate-ok');

    const response = await request(app)
      .patch(`/api/v1/auth/users/${user.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.userId).toBe(user.id);
    expect(response.body.data).toHaveProperty('cascadeApplied');
    expect(typeof response.body.data.cascadeApplied).toBe('boolean');
    // Usuario CLIENT: no dispara cascada de citas/servicios
    expect(response.body.data.cascadeApplied).toBe(false);
  });

  // Debería rechazar sin autenticación
  it('should reject without authentication', async () => {
    const user = await registerClient('deactivate-noauth');

    const response = await request(app).patch(`/api/v1/auth/users/${user.id}/deactivate`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  // Debería rechazar con token de CLIENT (no ADMIN)
  it('should reject with a CLIENT token', async () => {
    const targetUser = await registerClient('deactivate-target');
    const clientUser = await registerClient('deactivate-requester');

    const loginResponse = await request(app).post('/api/v1/auth/login').send({
      email: clientUser.email,
      password: 'TestPass123!',
    });
    const clientToken = loginResponse.body.data.token;

    const response = await request(app)
      .patch(`/api/v1/auth/users/${targetUser.id}/deactivate`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  // Debería devolver 400 si el id no es un UUID válido (F11: validación agregada a la ruta)
  it('should return 400 when id is not a valid UUID', async () => {
    const response = await request(app)
      .patch('/api/v1/auth/users/not-a-valid-uuid/deactivate')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  // Debería devolver 404 si el usuario no existe
  it('should return 404 when the user does not exist', async () => {
    // UUID v4 sintácticamente válido (pasa tanto el isUUID() de la ruta como el regex
    // más estricto del use case) pero que no corresponde a ningún usuario real
    const nonExistentId = generateUuid();

    const response = await request(app)
      .patch(`/api/v1/auth/users/${nonExistentId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  // Debería devolver 422 si el usuario ya está inactivo
  it('should return 422 when the user is already deactivated', async () => {
    const user = await registerClient('deactivate-twice');

    const firstResponse = await request(app)
      .patch(`/api/v1/auth/users/${user.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .patch(`/api/v1/auth/users/${user.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(secondResponse.status).toBe(422);
    expect(secondResponse.body.success).toBe(false);
  });
});
