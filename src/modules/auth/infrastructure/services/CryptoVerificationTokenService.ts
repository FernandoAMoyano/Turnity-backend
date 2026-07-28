import { VerificationTokenType } from '@prisma/client';
import {
  VerificationTokenService,
  IssuedVerificationToken,
  IssueTokenMeta,
} from '../../application/services/VerificationTokenService';
import { IVerificationTokenRepository } from '../../domain/repositories/IVerificationTokenRepository';
import { generateOpaqueToken, hashToken } from '../../../../shared/crypto/opaqueToken';
import { InvalidTokenError } from '../../../../shared/exceptions/InvalidTokenError';
import { env } from '../../../../shared/config/env';

/**
 * Implementacion de VerificationTokenService.
 *
 * Reutiliza el helper cripto compartido (`opaqueToken`) para generar/hashear,
 * sin tocar el `CryptoRefreshTokenService` de sesion. Orquesta la persistencia
 * a traves del repositorio inyectado.
 */
export class CryptoVerificationTokenService implements VerificationTokenService {
  /**
   * @param repository - Repositorio de tokens de verificacion inyectado
   */
  constructor(private readonly repository: IVerificationTokenRepository) {}

  /**
   * Emite un token nuevo, invalidando los previos activos del mismo tipo.
   * Solo se persiste el hash; el valor en claro se devuelve al caller.
   */
  async issue(
    userId: string,
    type: VerificationTokenType,
    meta?: IssueTokenMeta,
  ): Promise<IssuedVerificationToken> {
    // Un unico token vigente por (userId, type): invalidamos los anteriores.
    await this.repository.invalidateActiveByUser(userId, type);

    const token = generateOpaqueToken();
    const tokenHash = hashToken(token);
    const expiresAt = this.computeExpiry(type);

    await this.repository.create({
      userId,
      type,
      tokenHash,
      expiresAt,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    });

    return { token, expiresAt };
  }

  /**
   * Valida y consume un token. Lanza InvalidTokenError si no existe, es de otro
   * tipo, ya fue consumido o expiro (sin distinguir el motivo, a proposito).
   */
  async verifyAndConsume(rawToken: string, type: VerificationTokenType): Promise<string> {
    const tokenHash = hashToken(rawToken);
    const record = await this.repository.findByTokenHash(tokenHash);

    if (!record || record.type !== type || !record.isUsable()) {
      throw new InvalidTokenError();
    }

    await this.repository.consume(record.id);
    return record.userId;
  }

  /**
   * Calcula la expiracion segun el tipo, a partir de los TTL configurados en env.
   * @private
   */
  private computeExpiry(type: VerificationTokenType): Date {
    const now = Date.now();
    if (type === 'PASSWORD_RESET') {
      return new Date(now + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    }
    return new Date(now + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  }
}
