/**
 * Entidad de dominio que representa una sesión de refresh token.
 *
 * El refresh en sí es opaco y NUNCA se guarda en claro: esta entidad solo
 * contiene su hash (`tokenHash`). Soporta rotación con detección de reuse
 * (RFC 9700 4.14): todas las rotaciones descendientes de un mismo login
 * comparten `familyId`, y `replacedById` traza la cadena de reemplazos.
 */
export class RefreshTokenSession {
  /**
   * @param id - Identificador de la sesión (= jti)
   * @param familyId - Agrupa la cadena de rotación (para revocar toda la familia ante reuse)
   * @param userId - Usuario dueño de la sesión
   * @param tokenHash - SHA-256 del refresh opaco (nunca el token en claro)
   * @param expiresAt - Momento de expiración
   * @param revokedAt - Momento de revocación, o null si sigue vigente
   * @param replacedById - ID del token que reemplazó a este al rotar, o null
   * @param userAgent - User-Agent del cliente al emitir (auditoría), o null
   * @param ipAddress - IP del cliente al emitir (auditoría), o null
   * @param issuedAt - Momento de emisión
   */
  constructor(
    public readonly id: string,
    public readonly familyId: string,
    public readonly userId: string,
    public readonly tokenHash: string,
    public readonly expiresAt: Date,
    public readonly revokedAt: Date | null,
    public readonly replacedById: string | null,
    public readonly userAgent: string | null,
    public readonly ipAddress: string | null,
    public readonly issuedAt: Date,
  ) {}

  /**
   * Indica si la sesión ya expiró
   * @param now - Momento de referencia (default: ahora)
   */
  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Indica si la sesión fue revocada (logout, rotación o reuse)
   */
  isRevoked(): boolean {
    return this.revokedAt !== null;
  }

  /**
   * Indica si la sesión es utilizable: ni revocada ni expirada
   * @param now - Momento de referencia (default: ahora)
   */
  isActive(now: Date = new Date()): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }
}
