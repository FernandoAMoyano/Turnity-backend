import { VerificationTokenType } from '@prisma/client';
import { IUserRepository } from '../../domain/repositories/IUserRepository';
import { VerificationTokenService } from '../services/VerificationTokenService';

/**
 * Caso de uso: verificar el email de un usuario a partir del token del enlace.
 *
 * Delega en VerificationTokenService la validacion + consumo single-use (que
 * lanza InvalidTokenError si el token es invalido/expirado/ya usado) y luego
 * marca el email como verificado. La marca es idempotente: si el usuario ya
 * estaba verificado, volver a marcarlo no tiene efecto adverso.
 */
export class VerifyEmail {
  constructor(
    private userRepository: IUserRepository,
    private verificationTokenService: VerificationTokenService,
  ) {}

  /**
   * @param token - Token opaco recibido por el enlace de verificacion
   * @throws InvalidTokenError si el token es invalido, de otro tipo, expirado o ya usado
   */
  async execute(token: string): Promise<void> {
    const userId = await this.verificationTokenService.verifyAndConsume(
      token,
      VerificationTokenType.EMAIL_VERIFICATION,
    );
    await this.userRepository.markEmailAsVerified(userId);
  }
}
