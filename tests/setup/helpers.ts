import request from 'supertest';
import app from '../../src/app';
import { testPrisma } from './database';
import { RoleName } from '@prisma/client';

// Cache para roles
let cachedRoles: any = null;

const getRoles = async () => {
  if (!cachedRoles) {
    const adminRole = await testPrisma.role.findFirst({
      where: { name: RoleName.ADMIN },
    });

    const clientRole = await testPrisma.role.findFirst({
      where: { name: RoleName.CLIENT },
    });

    const stylistRole = await testPrisma.role.findFirst({
      where: { name: RoleName.STYLIST },
    });

    if (!adminRole || !clientRole || !stylistRole) {
      throw new Error('Roles del seed no encontrados. Ejecuta: npm run docker:db:prisma:seed');
    }

    cachedRoles = {
      admin: adminRole,
      client: clientRole,
      stylist: stylistRole,
    };
  }
  return cachedRoles;
};

export const createTestUser = async (roleType: 'CLIENT' | 'ADMIN' | 'STYLIST' = 'CLIENT') => {
  const roles = await getRoles();
  const role = roles[roleType.toLowerCase()];

  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      phone: '+1234567890',
      password: 'TestPass123!',
      roleId: role.id,
    });

  if (response.status !== 201) {
    throw new Error(`Registro falló: ${response.status}`);
  }

  // Gating de login activo en test: verificamos el email con el devToken (expuesto
  // en test via EXPOSE_VERIFICATION_TOKENS) para que el usuario pueda loguear.
  const devToken = response.body.devToken;
  if (devToken) {
    await request(app).post('/api/v1/auth/verify-email').send({ token: devToken });
  }

  return response.body.data;
};

// Extrae el valor de una cookie desde el array Set-Cookie de una respuesta
export const extractCookie = (
  setCookie: string[] | undefined,
  name: string,
): string | undefined => {
  if (!setCookie) return undefined;
  const found = setCookie.find((c) => c.startsWith(`${name}=`));
  return found ? found.split(';')[0].slice(name.length + 1) : undefined;
};

export const loginTestUser = async () => {
  const userData = await createTestUser('CLIENT');

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: userData.user?.email || userData.email,
      password: 'TestPass123!',
    });

  if (response.status !== 200) {
    throw new Error(`Login falló: ${response.status}`);
  }

  const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;

  return {
    token: response.body.data.token,
    // El refresh y el CSRF ahora viajan por cookie (F5b), no en el body.
    refreshToken: extractCookie(setCookie, 'refreshToken'),
    csrfToken: extractCookie(setCookie, 'csrfToken'),
    user: response.body.data.user,
  };
};

export const loginAsAdmin = async () => {
  const response = await request(app).post('/api/v1/auth/login').send({
    email: 'admin@turnity.com',
    password: 'admin123',
  });

  if (response.status !== 200) {
    throw new Error(`Login admin falló: ${response.status}`);
  }

  return response.body.data.token;
};

// Re-export services helpers
export * from './services-helpers';
