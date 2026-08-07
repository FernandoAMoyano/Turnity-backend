import { JwtService, JwtPayload } from '../services/JwtService';
import { RefreshTokenService } from '../services/RefreshTokenService';
import { UnauthorizedError } from '../../../../shared/exceptions/UnauthorizedError';
import { NotFoundError } from '../../../../shared/exceptions/NotFoundError';
import { logger } from '../../../../shared/logger/logger';
import { LoginResponseDto } from '../dto/response/LoginResponseDto';
import { IUserRepository } from '../../domain/repositories/IUserRepository';
import { IRoleRepository } from '../../domain/repositories/IRoleRepository';
import { IRefreshTokenRepository } from '../../domain/repositories/IRefreshTokenRepository';

/**
 * Contexto opcional de la request para auditar la rotación (RFC 6819).
 * Lo provee la capa HTTP; puede venir vacío.
 */
export interface RefreshContext {
  requestId?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Caso de uso para renovar tokens usando un refresh token opaco y rotativo.
 *
 * Implementa el patrón de refresh token rotation con detección de reuse
 * (RFC 9700 4.14): cada uso válido rota el token (emite uno nuevo e invalida
 * el anterior). Si se presenta un refresh ya rotado/revocado, se interpreta
 * como reuse (token robado o cliente desincronizado) y se revoca TODA la
 * familia de sesiones como medida fail-safe.
 */
export class RefreshToken {
  constructor(
    private userRepository: IUserRepository,
    private roleRepository: IRoleRepository,
    private jwtService: JwtService,
    private refreshTokenRepository: IRefreshTokenRepository,
    private refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Ejecuta la renovación con rotación
   * @param refreshToken - Refresh token opaco recibido del cliente
   * @param context - Contexto opcional de la request (requestId, userAgent, ip)
   * @returns Promise con nuevos tokens y datos actualizados del usuario
   * @throws UnauthorizedError si el refresh es inválido, expirado, reusado o el usuario está inactivo
   * @throws NotFoundError si el rol asociado no existe
   */
  async execute(refreshToken: string, context?: RefreshContext): Promise<LoginResponseDto> {
    const tokenHash = this.refreshTokenService.hash(refreshToken);
    const session = await this.refreshTokenRepository.findByTokenHash(tokenHash);

    // 1. No existe ninguna sesión con ese hash -> token inválido
    if (!session) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // 2. Reuse detection: la sesión existe pero ya fue revocada/rotada.
    // Se revoca toda la familia y se rechaza (RFC 9700 4.14).
    if (session.isRevoked()) {
      await this.refreshTokenRepository.revokeFamily(session.familyId);
      logger.warn('refresh_reuse_detected', {
        event: 'refresh_reuse_detected',
        userId: session.userId,
        familyId: session.familyId,
        sessionId: session.id,
        requestId: context?.requestId,
        ip: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      throw new UnauthorizedError('Invalid refresh token');
    }

    // 3. Sesión expirada -> token inválido
    if (session.isExpired()) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // 4. Validar estado del usuario. Si está inactivo, se revoca la sesión.
    const user = await this.userRepository.findById(session.userId);
    if (!user || !user.isActive) {
      await this.refreshTokenRepository.revokeById(session.id);
      throw new UnauthorizedError('Invalid refresh token');
    }

    const role = await this.roleRepository.findById(user.roleId);
    if (!role) {
      throw new NotFoundError('Role', user.roleId);
    }

    // 5. Rotación: emitir access nuevo + refresh opaco nuevo, y rotar la sesión
    // (revoca la actual y crea la nueva en la misma familia, atómicamente).
    const jwtPayload: JwtPayload = {
      userId: user.id,
      roleId: user.roleId,
      email: user.email,
    };

    const newAccessToken = this.jwtService.generateAccessToken(jwtPayload);
    const generated = this.refreshTokenService.generate();

    const rotated = await this.refreshTokenRepository.rotate(session.id, {
      familyId: session.familyId,
      userId: user.id,
      tokenHash: generated.hash,
      expiresAt: generated.expiresAt,
      userAgent: context?.userAgent ?? null,
      ipAddress: context?.ipAddress ?? null,
    });

    // Carrera: otra request concurrente ya rotó esta sesión entre la
    // verificación y este punto. Se rechaza sin revocar la familia (el token
    // era válido al momento del check; no es un reuse malicioso).
    if (!rotated) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    return {
      token: newAccessToken,
      refreshToken: generated.token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isActive: user.isActive,
        profilePicture: user.profilePicture,
        preferences: user.preferences,
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
        },
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }
}
