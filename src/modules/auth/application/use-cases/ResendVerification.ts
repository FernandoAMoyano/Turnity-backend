import { VerificationTokenType } from '@prisma/client';
import { IUserRepository } from '../../domain/repositories/IUserRepository';
import { VerificationTokenService } from '../services/VerificationTokenService';
import { EmailService } from '../../../../shared/email/EmailService';
import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';

/**
 * Resultado del reenvio: en no-produccion con EXPOSE_VERIFICATION_TOKENS puede
 * traer el token en claro (solo cuando realmente se emitio uno). El controller
 * decide si exponerlo.
 */
export interface ResendVerificationResult {
  verificationToken?: string;
}

/**
 * Caso de uso: reenviar el email de verificacion.
 *
 * Anti-enumeracion (F-auth 2.6): la respuesta es SIEMPRE la misma, exista o no
 * el email y este verificado o no. Solo se emite/envia un token nuevo cuando el
 * usuario existe y aun no esta verificado; en cualquier otro caso no se hace
 * nada y se devuelve un resultado vacio.
 */
export class ResendVerification {
  constructor(
    private userRepository: IUserRepository,
    private verificationTokenService: VerificationTokenService,
    private emailService: EmailService,
  ) {}

  /**
   * @param email - Email para el que se pide el reenvio
   * @returns resultado (con token solo si se emitio y el entorno lo permite)
   */
  async execute(email: string): Promise<ResendVerificationResult> {
    const user = await this.userRepository.findByEmailWithRole(email);

    // No filtrar existencia ni estado: mismo resultado si no existe o ya verificado.
    if (!user || user.emailVerified) {
      return {};
    }

    try {
      const { token } = await this.verificationTokenService.issue(
        user.id,
        VerificationTokenType.EMAIL_VERIFICATION,
      );
      const verificationUrl = `${env.FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;
      await this.emailService.sendVerificationEmail({
        to: user.email,
        name: user.name,
        verificationUrl,
        expiresInHours: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
      });
      return { verificationToken: token };
    } catch (error) {
      // best-effort: no propagamos el fallo para no filtrar informacion ni romper
      // la respuesta uniforme; queda registrado para diagnostico.
      logger.error('[auth] fallo al reenviar la verificacion de email', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }
}
