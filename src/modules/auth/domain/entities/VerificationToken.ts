import { VerificationTokenType } from '@prisma/client';

/**
 * Entidad de dominio de un token de verificacion de email o reset de password.
 *
 * El token en si es opaco y NUNCA se guarda en claro: esta entidad solo tiene
 * su hash (`tokenHash`). Es de un solo uso (`consumedAt`) y con expiracion
 * (`expiresAt`). El ciclo de vida es distinto al del refresh de sesion (sin
 * rotacion ni familias), por eso vive en su propia tabla.
 */
export class VerificationToken {
  /**
   * @param id - Identificador del token
   * @param userId - Usuario dueño del token
   * @param type - Tipo (EMAIL_VERIFICATION | PASSWORD_RESET)
   * @param tokenHash - SHA-256 del token opaco (nunca el valor en claro)
   * @param expiresAt - Momento de expiracion
   * @param consumedAt - Momento en que se consumio/invalido, o null si sigue activo
   * @param ipAddress - IP del cliente al emitir (auditoria), o null
   * @param userAgent - User-Agent del cliente al emitir (auditoria), o null
   * @param createdAt - Momento de emision
   */
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly type: VerificationTokenType,
    public readonly tokenHash: string,
    public readonly expiresAt: Date,
    public readonly consumedAt: Date | null,
    public readonly ipAddress: string | null,
    public readonly userAgent: string | null,
    public readonly createdAt: Date,
  ) {}

  /**
   * Indica si el token ya expiro
   * @param now - Momento de referencia (default: ahora)
   */
  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Indica si el token ya fue consumido o invalidado
   */
  isConsumed(): boolean {
    return this.consumedAt !== null;
  }

  /**
   * Indica si el token es utilizable: ni consumido ni expirado
   * @param now - Momento de referencia (default: ahora)
   */
  isUsable(now: Date = new Date()): boolean {
    return !this.isConsumed() && !this.isExpired(now);
  }
}
