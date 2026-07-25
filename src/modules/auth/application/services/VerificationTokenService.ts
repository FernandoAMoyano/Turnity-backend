import { VerificationTokenType } from '@prisma/client';

/**
 * Resultado de emitir un token: el valor opaco en claro (para enviar por email,
 * nunca se persiste) y su expiracion.
 */
export interface IssuedVerificationToken {
  /** Token opaco en claro, para el enlace del email */
  token: string;
  /** Momento de expiracion calculado segun el TTL del tipo */
  expiresAt: Date;
}

/** Metadata opcional de auditoria al emitir un token */
export interface IssueTokenMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Puerto para la emision y verificacion de tokens de un solo uso (verificacion
 * de email / reset de password). Encapsula el patron opaco + hash + expiracion
 * + single-use, reutilizado por los use-cases (verify, resend, forgot, reset)
 * para no duplicar esa logica en cada uno.
 */
export interface VerificationTokenService {
  /**
   * Emite un token nuevo del tipo dado para el usuario. Invalida primero los
   * previos activos del mismo (userId, type), dejando un unico token vigente.
   * @returns El token opaco en claro + su expiracion
   */
  issue(
    userId: string,
    type: VerificationTokenType,
    meta?: IssueTokenMeta,
  ): Promise<IssuedVerificationToken>;

  /**
   * Valida un token en claro contra su tipo: existencia, tipo correcto, no
   * consumido y no expirado. Si es valido lo consume (single-use) y devuelve el
   * `userId`. Si no, lanza `InvalidTokenError`.
   * @returns userId dueño del token
   */
  verifyAndConsume(rawToken: string, type: VerificationTokenType): Promise<string>;
}
