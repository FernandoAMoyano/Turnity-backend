import { PrismaClient } from '@prisma/client';

/**
 * Verifica que la base de datos este accesible, ejecutando una consulta
 * minima (SELECT 1).
 *
 * Se usa desde el endpoint /ready (readiness probe) -- a diferencia de
 * /health (liveness, no toca la base), este chequeo responde la pregunta
 * "¿esta la app en condiciones de recibir trafico real ahora mismo?".
 * No se usa como HEALTHCHECK de Docker a proposito: un blip transitorio
 * de la base no deberia disparar un reinicio del contenedor.
 *
 * Recibe solo la porcion de PrismaClient que necesita (Pick) para poder
 * testear la funcion con un mock minimo, sin mockear el cliente completo.
 *
 * @param prisma Cliente de Prisma (o un mock con $queryRaw) a verificar.
 * @returns true si la base respondio, false si la consulta fallo o tiro error.
 */
export const checkDatabaseReadiness = async (
  prisma: Pick<PrismaClient, '$queryRaw'>,
): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};
