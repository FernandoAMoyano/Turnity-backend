import request from 'supertest';
import app from '../../src/app';

/**
 * E2E del flujo completo de registro publico seguro:
 * - registro -> verificacion de email -> login (con gating antes de verificar)
 * - forgot-password -> reset-password -> login con la nueva password
 * - registro -> reenvio de verificacion -> verificacion -> login
 *
 * En test el token viaja como devToken (EXPOSE_VERIFICATION_TOKENS) y no se
 * envian mails reales (jsonTransport).
 */
describe('Public Registration Complete Flow E2E', () => {
  const uniqueEmail = (prefix: string): string =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  // Flujo completo: registro -> (login bloqueado) -> verificar -> login -> perfil
  it('should complete register -> verify -> login -> profile', async () => {
    const email = uniqueEmail('e2e-verify');

    // 1. Registro
    const register = await request(app).post('/api/v1/auth/register').send({
      name: 'E2E User',
      email,
      phone: '+1234567890',
      password: 'TestPass123!',
    });
    expect(register.status).toBe(201);
    const devToken = register.body.devToken;
    expect(devToken).toBeDefined();

    // 2. Login antes de verificar -> bloqueado por gating
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'TestPass123!' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

    // 3. Verificar email
    const verify = await request(app).post('/api/v1/auth/verify-email').send({ token: devToken });
    expect(verify.status).toBe(200);

    // 4. Login ahora funciona
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'TestPass123!' });
    expect(login.status).toBe(200);
    const token = login.body.data.token;

    // 5. Perfil accesible con el access token
    const profile = await request(app)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.email).toBe(email);
  });

  // Flujo completo: forgot -> reset -> login con la nueva password
  it('should complete forgot -> reset -> login with the new password', async () => {
    const email = uniqueEmail('e2e-reset');

    // Registro + verificacion
    const register = await request(app).post('/api/v1/auth/register').send({
      name: 'E2E Reset User',
      email,
      phone: '+1234567890',
      password: 'TestPass123!',
    });
    await request(app).post('/api/v1/auth/verify-email').send({ token: register.body.devToken });

    // Forgot password
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(200);
    const resetToken = forgot.body.devToken;
    expect(resetToken).toBeDefined();

    // Reset password
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'NewPass456!' });
    expect(reset.status).toBe(200);

    // La nueva password funciona; la vieja no
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewPass456!' });
    expect(newLogin.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'TestPass123!' });
    expect(oldLogin.status).toBe(401);
  });

  // Flujo de reenvio: registro -> resend -> verificar con el token reenviado -> login
  it('should complete register -> resend verification -> verify -> login', async () => {
    const email = uniqueEmail('e2e-resend');

    await request(app).post('/api/v1/auth/register').send({
      name: 'E2E Resend User',
      email,
      phone: '+1234567890',
      password: 'TestPass123!',
    });

    // Reenviar verificacion (emite un token nuevo, invalida el anterior)
    const resend = await request(app).post('/api/v1/auth/resend-verification').send({ email });
    expect(resend.status).toBe(200);
    const resendToken = resend.body.devToken;
    expect(resendToken).toBeDefined();

    // Verificar con el token reenviado
    const verify = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: resendToken });
    expect(verify.status).toBe(200);

    // Login funciona
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'TestPass123!' });
    expect(login.status).toBe(200);
  });
});
