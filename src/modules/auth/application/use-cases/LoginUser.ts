import { IUserRepository, UserWithRole } from '../../domain/repositories/IUserRepository';
import { IRefreshTokenRepository } from '../../domain/repositories/IRefreshTokenRepository';
import { HashService } from '../services/HashService';
import { JwtPayload, JwtService } from '../services/JwtService';
import { RefreshTokenService } from '../services/RefreshTokenService';
import { LoginDto } from '../dto/request/LoginDto';
import { LoginResponseDto } from '../dto/response/LoginResponseDto';
import { UserDto } from '../dto/response/UserDto';
import { isValidEmail } from '../../../../shared/utils/validation';
import { generateUuid } from '../../../../shared/utils/uuid';
import { ValidationError } from '../../../../shared/exceptions/ValidationError';
import { UnauthorizedError } from '../../../../shared/exceptions/UnauthorizedError';
import { EmailNotVerifiedError } from '../../../../shared/exceptions/EmailNotVerifiedError';
import { env } from '../../../../shared/config/env';

/**
 * Contexto opcional de la request para auditar la sesión (RFC 6819).
 * Lo provee la capa HTTP.
 */
export interface LoginContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Caso de uso para autenticar usuarios en el sistema
 * Valida credenciales, verifica el estado del usuario y genera tokens JWT
 */
export class LoginUser {
  constructor(
    private userRepository: IUserRepository,
    private hashService: HashService,
    private jwtService: JwtService,
    private refreshTokenRepository: IRefreshTokenRepository,
    private refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Ejecuta el proceso de autenticación de usuario
   * @param loginDto - Datos de login (email y contraseña)
   * @returns Promise con los datos de respuesta del login incluyendo tokens y datos del usuario
   * @throws ValidationError si el email o contraseña no son válidos
   * @throws UnauthorizedError si las credenciales son incorrectas o el usuario está inactivo
   * @description Valida formato de email, verifica credenciales, genera tokens JWT y retorna datos del usuario
   */
  async execute(loginDto: LoginDto, context?: LoginContext): Promise<LoginResponseDto> {
    if (!loginDto.email || !isValidEmail(loginDto.email)) {
      throw new ValidationError('Invalid email format');
    }

    if (!loginDto.password) {
      throw new ValidationError('Password is required');
    }

    const userWithRole = await this.userRepository.findByEmailWithRole(loginDto.email);
    if (!userWithRole) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!userWithRole.isActive) {
      throw new UnauthorizedError('User account is inactive');
    }

    const isValidPassword = await this.hashService.compare(
      loginDto.password,
      userWithRole.password,
    );
    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const role = userWithRole.role;
    if (!role) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Gating de verificacion de email (F-auth). Se chequea DESPUES de validar las
    // credenciales para no filtrar el estado de verificacion a quien no conoce la
    // password. Gateado por REQUIRE_EMAIL_VERIFICATION (default true).
    if (env.REQUIRE_EMAIL_VERIFICATION && !userWithRole.emailVerified) {
      throw new EmailNotVerifiedError();
    }

    // Generar tokens
    const jwtPayload: JwtPayload = {
      userId: userWithRole.id,
      roleId: userWithRole.roleId,
      email: userWithRole.email,
    };

    const token = this.jwtService.generateAccessToken(jwtPayload);

    // Refresh opaco + persistencia de la sesión (nueva familia por login).
    // El token en claro se devuelve para que la capa HTTP lo entregue al
    // cliente (en F5b pasará a cookie httpOnly); en la base solo queda su hash.
    // La rotación/reuse se maneja en el caso de uso RefreshToken (F4).
    const generated = this.refreshTokenService.generate();
    await this.refreshTokenRepository.create({
      familyId: generateUuid(),
      userId: userWithRole.id,
      tokenHash: generated.hash,
      expiresAt: generated.expiresAt,
      userAgent: context?.userAgent ?? null,
      ipAddress: context?.ipAddress ?? null,
    });

    return {
      token,
      refreshToken: generated.token,
      user: this.mapUserToDto(userWithRole, role),
    };
  }

  /**
   * Convierte una entidad User con Role a su representación DTO
   * @param user - Entidad de usuario con datos completos
   * @param role - Entidad de rol asociada al usuario
   * @returns Objeto DTO con los datos del usuario formateados para respuesta
   * @private
   */
  private mapUserToDto(user: UserWithRole, role: UserWithRole['role']): UserDto {
    return {
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
        description: role.description ?? undefined,
      },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
