import { IRefreshTokenRepository } from '../../domain/repositories/IRefreshTokenRepository';

/**
 * Caso de uso para cerrar todas las sesiones activas del usuario
 * ("logout de todos los dispositivos"). Revoca en bloque todos los refresh
 * tokens vigentes del usuario (ASVS 5.0 V7 / NIST SP 800-63B).
 */
export class LogoutAllSessions {
  constructor(private refreshTokenRepository: IRefreshTokenRepository) {}

  /**
   * Revoca todas las sesiones activas del usuario
   * @param userId - ID del usuario autenticado
   * @returns Cantidad de sesiones revocadas
   */
  async execute(userId: string): Promise<number> {
    return this.refreshTokenRepository.revokeAllForUser(userId);
  }
}
