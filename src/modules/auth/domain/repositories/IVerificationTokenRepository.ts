import { VerificationTokenType } from '@prisma/client';
import { VerificationToken } from '../entities/VerificationToken';

/**
 * Datos para persistir un nuevo token de verificacion/reset.
 * `id` es opcional: si no se provee, la base genera el uuid por default.
 * El token ya viene hasheado en `tokenHash` (nunca en claro).
 */
export interface CreateVerificationTokenData {
  id?: string;
  userId: string;
  type: VerificationTokenType;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Contrato de persistencia para tokens de verificacion/reset.
 * Abstrae el almacenamiento sin exponer detalles de Prisma/DB.
 */
export interface IVerificationTokenRepository {
  /**
   * Crea un nuevo token (ya hasheado)
   */
  create(data: CreateVerificationTokenData): Promise<VerificationToken>;

  /**
   * Busca un token por el hash de su valor opaco
   * @param tokenHash - SHA-256 del token recibido
   * @returns El token o null si no existe
   */
  findByTokenHash(tokenHash: string): Promise<VerificationToken | null>;

  /**
   * Marca un token como consumido (single-use). Idempotente y condicional:
   * solo afecta si aun no estaba consumido.
   * @param id - ID del token
   */
  consume(id: string): Promise<void>;

  /**
   * Invalida (marca como consumidos) todos los tokens aun activos de un usuario
   * para un tipo dado. Se usa al emitir uno nuevo, para dejar un unico token
   * vigente por (userId, type).
   * @returns Cantidad de tokens invalidados
   */
  invalidateActiveByUser(userId: string, type: VerificationTokenType): Promise<number>;

  /**
   * Elimina tokens ya expirados (barrido de mantenimiento)
   * @param now - Momento de referencia
   * @returns Cantidad de tokens eliminados
   */
  deleteExpired(now: Date): Promise<number>;
}
