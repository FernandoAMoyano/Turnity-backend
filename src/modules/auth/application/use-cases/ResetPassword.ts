import { VerificationTokenType } from '@prisma/client';
import { IUserRepository } from '../../domain/repositories/IUserRepository';
import { IRefreshTokenRepository } from '../../domain/repositories/IRefreshTokenRepository';
import { VerificationTokenService } from '../services/VerificationTokenService';
import { HashService } from '../services/HashService';
import { isValidPassword } from '../../../../shared/utils/validation';
import { ValidationError } from '../../../../shared/exceptions/ValidationError';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { ResetPasswordDto } from '../dto/request/ResetPasswordDto';

/**
 * Caso de uso: aplicar el reset de password a partir del token del enlace.
 *
 * Valida la fuerza de la nueva password ANTES de consumir el token (para no
 * gastarlo con una password invalida), luego consume el token single-use,
 * actualiza el hash y revoca TODAS las sesiones del usuario (expulsa a un posible
 * atacante con sesion activa).
 */
export class ResetPassword {
  constructor(
    private userRepository: IUserRepository,
    private verificationTokenService: VerificationTokenService,
    private hashService: HashService,
    private refreshTokenRepository: IRefreshTokenRepository,
  ) {}

  /**
   * @param dto - Token del enlace + nueva password
   * @throws ValidationError si la password no cumple las reglas de fuerza
   * @throws InvalidTokenError si el token es invalido, de otro tipo, expirado o ya usado
   * @throws NotFoundError si el usuario del token ya no existe
   */
  async execute(dto: ResetPasswordDto): Promise<void> {
    if (!isValidPassword(dto.password)) {
      throw new ValidationError(
        'Password must be at least 8 characters long and contain uppercase, lowercase, and number',
      );
    }

    const userId = await this.verificationTokenService.verifyAndConsume(
      dto.token,
      VerificationTokenType.PASSWORD_RESET,
    );

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User', userId);
    }

    const hashedPassword = await this.hashService.hash(dto.password);
    user.updatePassword(hashedPassword);
    await this.userRepository.update(user);

    // Seguridad: invalidar todas las sesiones activas tras cambiar la password.
    await this.refreshTokenRepository.revokeAllForUser(userId);
  }
}
