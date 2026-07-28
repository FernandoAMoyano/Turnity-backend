import { PrismaClient } from '@prisma/client';

// Usar la misma instancia de Prisma para todo
const prisma = new PrismaClient();

// Limpiar solo usuarios de test (mantener datos de seed)
export const cleanupTestUsers = async () => {
  try {
    // Solo eliminar usuarios que contengan "test" en el email
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: 'test',
        },
      },
    });
  } catch {
    // Ignorar errores de limpieza
  }
};

export { prisma as testPrisma };
