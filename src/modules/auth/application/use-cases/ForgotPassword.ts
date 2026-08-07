import { VerificationTokenType } from '@prisma/client';
import { IUserRepository } from '../../domain/repositories/IUserRepository';
import { VerificationTokenService } from '../services/VerificationTokenService';
import { EmailService } from '../../../../shared/email/EmailService';
import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';

/**
 * Resultado del forgot-password: en no-produccion con EXPOSE_VERIFICATION_TOKENS
 * puede traer el token en claro (solo cuando realmente se emitio uno).
 */
export interface ForgotPasswordResult {
  resetToken?: string;
}

/**
 * Caso de uso: solicitar el reset de password.
 *
 * Anti-enumeracion: la respuesta es SIEMPRE la misma, exista o no el email. Solo
 * se emite/envia un token cuando el usuario existe y esta activo; en cualquier
 * otro caso no se hace nada y se devuelve un resultado vacio.
 */
export class ForgotPassword {
  constructor(
    private userRepository: IUserRepository,
    private verificationTokenService: VerificationTokenService,
    private emailService: EmailService,
  ) {}

  /**
   * @param email - Email para el que se solicita el reset
   * @returns resultado (con token solo si se emitio y el entorno lo permite)
   */
  async execute(email: string): Promise<ForgotPasswordResult> {
    const user = await this.userRepository.findByEmailWithRole(email);

    // No filtrar existencia ni estado: mismo resultado si no existe o esta inactivo.
    if (!user || !user.isActive) {
      return {};
    }

    try {
      const { token } = await this.verificationTokenService.issue(
        user.id,
        VerificationTokenType.PASSWORD_RESET,
      );
      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await this.emailService.sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresInMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      });
      return { resetToken: token };
    } catch (error) {
      // best-effort: no propagamos el fallo para no filtrar informacion ni romper
      // la respuesta uniforme; queda registrado para diagnostico.
      logger.error('[auth] fallo al emitir/enviar el reset de password', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }
}
