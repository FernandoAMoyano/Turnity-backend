import { RefreshTokenService } from '../services/RefreshTokenService';
import { IRefreshTokenRepository } from '../../domain/repositories/IRefreshTokenRepository';

/**
 * Caso de uso para cerrar la sesión actual del usuario.
 *
 * Revoca únicamente la sesión asociada al refresh token recibido (RFC 7009,
 * revocación por token). Es idempotente: si la sesión no existe, ya está
 * revocada o pertenece a otro usuario, no hace nada y no falla (tampoco
 * filtra información sobre tokens ajenos).
 */
export class LogoutUser {
  constructor(
    private refreshTokenRepository: IRefreshTokenRepository,
    private refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Revoca la sesión del refresh token recibido si pertenece al usuario
   * @param userId - ID del usuario autenticado (del access token)
   * @param refreshToken - Refresh token opaco a revocar
   */
  async execute(userId: string, refreshToken: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const tokenHash = this.refreshTokenService.hash(refreshToken);
    const session = await this.refreshTokenRepository.findByTokenHash(tokenHash);

    // Solo revoca si la sesión existe y es del usuario autenticado.
    if (session && session.userId === userId) {
      await this.refreshTokenRepository.revokeById(session.id);
    }
  }
}
