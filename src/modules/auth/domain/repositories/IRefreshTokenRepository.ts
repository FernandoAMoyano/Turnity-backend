import { RefreshTokenSession } from '../entities/RefreshTokenSession';

/**
 * Datos necesarios para persistir una nueva sesión de refresh token.
 * `id` es opcional: si no se provee, la implementación deja que la base
 * genere el uuid por default.
 */
export interface CreateRefreshTokenData {
  id?: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Contrato de persistencia para sesiones de refresh token.
 * Abstrae el almacenamiento sin exponer detalles de Prisma/DB.
 */
export interface IRefreshTokenRepository {
  /**
   * Crea una nueva sesión de refresh token
   * @param data - Datos de la sesión (el token ya viene hasheado en `tokenHash`)
   */
  create(data: CreateRefreshTokenData): Promise<RefreshTokenSession>;

  /**
   * Busca una sesión por el hash de su token
   * @param tokenHash - SHA-256 del refresh recibido
   * @returns La sesión o null si no existe
   */
  findByTokenHash(tokenHash: string): Promise<RefreshTokenSession | null>;

  /**
   * Rota una sesión de forma atómica: revoca la sesión `oldId`
   * (setea `revokedAt` y `replacedById`) y crea la nueva en una única
   * transacción. Núcleo de la rotación de refresh (RFC 9700 4.14).
   * @param oldId - ID de la sesión a revocar
   * @param newData - Datos de la nueva sesión (misma `familyId`)
   * @returns La nueva sesión creada, o `null` si la sesión ya fue rotada por
   *   otra request concurrente (se perdió la carrera; el llamador debe rechazar)
   */
  rotate(oldId: string, newData: CreateRefreshTokenData): Promise<RefreshTokenSession | null>;

  /**
   * Revoca una sesión puntual por su ID (idempotente)
   * @param id - ID de la sesión
   */
  revokeById(id: string): Promise<void>;

  /**
   * Revoca toda una familia de sesiones (respuesta a reuse detection).
   * Solo afecta las que aún no estén revocadas.
   * @param familyId - Familia a revocar
   */
  revokeFamily(familyId: string): Promise<void>;

  /**
   * Revoca todas las sesiones activas de un usuario ("logout de todos los dispositivos")
   * @param userId - Usuario cuyas sesiones se revocan
   * @returns Cantidad de sesiones revocadas
   */
  revokeAllForUser(userId: string): Promise<number>;

  /**
   * Elimina sesiones ya expiradas (barrido de mantenimiento)
   * @param now - Momento de referencia
   * @returns Cantidad de sesiones eliminadas
   */
  deleteExpired(now: Date): Promise<number>;
}
