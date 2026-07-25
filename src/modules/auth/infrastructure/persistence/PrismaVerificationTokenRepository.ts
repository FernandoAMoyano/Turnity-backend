import {
  PrismaClient,
  VerificationTokenType,
  VerificationToken as PrismaVerificationToken,
} from '@prisma/client';
import { VerificationToken } from '../../domain/entities/VerificationToken';
import {
  IVerificationTokenRepository,
  CreateVerificationTokenData,
} from '../../domain/repositories/IVerificationTokenRepository';

/**
 * Implementacion de IVerificationTokenRepository con Prisma.
 */
export class PrismaVerificationTokenRepository implements IVerificationTokenRepository {
  /**
   * @param prisma - Cliente Prisma inyectado
   */
  constructor(private prisma: PrismaClient) {}

  /**
   * Crea un nuevo token (ya hasheado)
   */
  async create(data: CreateVerificationTokenData): Promise<VerificationToken> {
    const row = await this.prisma.verificationToken.create({
      data: this.toCreateData(data),
    });
    return this.toDomain(row);
  }

  /**
   * Busca un token por el hash de su valor opaco
   */
  async findByTokenHash(tokenHash: string): Promise<VerificationToken | null> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
    });
    return row ? this.toDomain(row) : null;
  }

  /**
   * Marca un token como consumido. Condicional (solo si aun no lo estaba) para
   * ser idempotente y evitar sobrescribir el consumedAt original.
   */
  async consume(id: string): Promise<void> {
    await this.prisma.verificationToken.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * Invalida todos los tokens aun activos de un usuario para un tipo dado
   * @returns Cantidad de tokens invalidados
   */
  async invalidateActiveByUser(
    userId: string,
    type: VerificationTokenType,
  ): Promise<number> {
    const result = await this.prisma.verificationToken.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Elimina tokens ya expirados
   * @returns Cantidad de tokens eliminados
   */
  async deleteExpired(now: Date): Promise<number> {
    const result = await this.prisma.verificationToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }

  /**
   * Arma el objeto `data` para Prisma a partir del DTO de creacion
   * @private
   */
  private toCreateData(data: CreateVerificationTokenData) {
    return {
      ...(data.id ? { id: data.id } : {}),
      userId: data.userId,
      type: data.type,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    };
  }

  /**
   * Mapea un registro Prisma a la entidad de dominio
   * @private
   */
  private toDomain(row: PrismaVerificationToken): VerificationToken {
    return new VerificationToken(
      row.id,
      row.userId,
      row.type,
      row.tokenHash,
      row.expiresAt,
      row.consumedAt,
      row.ipAddress,
      row.userAgent,
      row.createdAt,
    );
  }
}
