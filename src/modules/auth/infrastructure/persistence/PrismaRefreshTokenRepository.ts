import { PrismaClient, RefreshToken as PrismaRefreshToken } from '@prisma/client';
import { RefreshTokenSession } from '../../domain/entities/RefreshTokenSession';
import {
  IRefreshTokenRepository,
  CreateRefreshTokenData,
} from '../../domain/repositories/IRefreshTokenRepository';

/**
 * Error interno: la sesión ya fue revocada/rotada concurrentemente entre la
 * verificación y el intento de rotación. No se propaga: se traduce a `null`.
 */
class RotateConflict extends Error {}

/**
 * Implementación de IRefreshTokenRepository con Prisma.
 * La rotación y la revocación de familia se apoyan en índices y en
 * transacciones para garantizar atomicidad frente a reuse concurrente.
 */
export class PrismaRefreshTokenRepository implements IRefreshTokenRepository {
  /**
   * @param prisma - Cliente Prisma inyectado
   */
  constructor(private prisma: PrismaClient) {}

  /**
   * Crea una nueva sesión de refresh token
   */
  async create(data: CreateRefreshTokenData): Promise<RefreshTokenSession> {
    const row = await this.prisma.refreshToken.create({
      data: this.toCreateData(data),
    });
    return this.toDomain(row);
  }

  /**
   * Busca una sesión por el hash de su token
   */
  async findByTokenHash(tokenHash: string): Promise<RefreshTokenSession | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    return row ? this.toDomain(row) : null;
  }

  /**
   * Rota de forma atómica: crea la nueva sesión y revoca la anterior
   * (revokedAt + replacedById) dentro de una única transacción.
   */
  async rotate(
    oldId: string,
    newData: CreateRefreshTokenData,
  ): Promise<RefreshTokenSession | null> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Revocación condicional y atómica: solo prospera si la sesión aún
        // estaba activa. Bajo concurrencia, la segunda transacción ve 0 filas
        // (ya revocada) y aborta -> se traduce a null (carrera perdida).
        const revoked = await tx.refreshToken.updateMany({
          where: { id: oldId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        if (revoked.count === 0) {
          throw new RotateConflict();
        }

        const newRow = await tx.refreshToken.create({
          data: this.toCreateData(newData),
        });

        await tx.refreshToken.update({
          where: { id: oldId },
          data: { replacedById: newRow.id },
        });

        return newRow;
      });

      return this.toDomain(created);
    } catch (error) {
      if (error instanceof RotateConflict) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Revoca una sesión puntual por ID (idempotente: si ya estaba revocada,
   * simplemente vuelve a fijar revokedAt sin fallar).
   */
  async revokeById(id: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoca todas las sesiones aún activas de una familia (reuse detection)
   */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoca todas las sesiones activas de un usuario (logout de todos los dispositivos)
   * @returns Cantidad de sesiones revocadas
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Elimina sesiones ya expiradas
   * @returns Cantidad de sesiones eliminadas
   */
  async deleteExpired(now: Date): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }

  /**
   * Arma el objeto `data` para Prisma a partir del DTO de creación
   * @private
   */
  private toCreateData(data: CreateRefreshTokenData) {
    return {
      ...(data.id ? { id: data.id } : {}),
      familyId: data.familyId,
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      userAgent: data.userAgent ?? null,
      ipAddress: data.ipAddress ?? null,
    };
  }

  /**
   * Mapea un registro Prisma a la entidad de dominio
   * @private
   */
  private toDomain(row: PrismaRefreshToken): RefreshTokenSession {
    return new RefreshTokenSession(
      row.id,
      row.familyId,
      row.userId,
      row.tokenHash,
      row.expiresAt,
      row.revokedAt,
      row.replacedById,
      row.userAgent,
      row.ipAddress,
      row.issuedAt,
    );
  }
}
