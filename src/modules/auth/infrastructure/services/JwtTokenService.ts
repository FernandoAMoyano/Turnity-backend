import * as jwt from 'jsonwebtoken';
import { JwtService, JwtPayload } from '../../application/services/JwtService';
import { env } from '../../../../shared/config/env';
import { UnauthorizedError } from '../../../../shared/exceptions/UnauthorizedError';
import { generateUuid } from '../../../../shared/utils/uuid';

/**
 * Implementación del servicio JWT usando jsonwebtoken
 * Maneja la generación y verificación de tokens de acceso y renovación
 */
export class JwtTokenService implements JwtService {
  /** Secreto para firmar tokens de acceso */
  private readonly accessTokenSecret: string;
  /** Secreto para firmar tokens de renovación */
  private readonly refreshTokenSecret: string;
  /** Tiempo de expiración para tokens de acceso */
  private readonly accessTokenExpiry: string;
  /** Tiempo de expiración para tokens de renovación */
  private readonly refreshTokenExpiry: string;

  /**
   * Constructor que inicializa configuración desde variables de entorno ya validadas
   * @description Toma secretos y tiempos de expiración de src/shared/config/env.ts
   * -- validados al arrancar el proceso, sin fallbacks inseguros
   */
  constructor() {
    this.accessTokenSecret = env.JWT_ACCESS_SECRET;
    this.refreshTokenSecret = env.JWT_REFRESH_SECRET;
    this.accessTokenExpiry = env.JWT_ACCESS_EXPIRY;
    this.refreshTokenExpiry = env.JWT_REFRESH_EXPIRY;
  }

  /**
   * Genera un token de acceso JWT con tiempo de vida corto
   * @param payload - Datos del usuario a incluir en el token
   * @returns Token JWT firmado para autorización de requests
   * @description Crea token con expiración corta, issuer y audience específicos
   */
  generateAccessToken(payload: JwtPayload): string {
    // subject (sub) y jwtid (jti) siguen el perfil RFC 9068 de access tokens.
    // Se agregan via SignOptions para no alterar la forma de JwtPayload ni la
    // verificacion existente (que ignora estos claims estandar).
    return jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiry,
      issuer: 'turnity-api',
      audience: 'turnity-app',
      subject: payload.userId,
      jwtid: generateUuid(),
    } as jwt.SignOptions);
  }

  /**
   * Genera un token de renovación JWT con tiempo de vida largo
   * @param payload - Datos del usuario a incluir en el token
   * @returns Token JWT firmado para renovar tokens de acceso
   * @description Crea token con expiración larga para renovar tokens de acceso
   */
  generateRefreshToken(payload: JwtPayload): string {
    return jwt.sign(payload, this.refreshTokenSecret, {
      expiresIn: this.refreshTokenExpiry,
      issuer: 'turnity-api',
      audience: 'turnity-app',
    } as jwt.SignOptions);
  }

  /**
   * Verifica y decodifica un token de acceso JWT
   * @param token - Token JWT a verificar
   * @returns Payload decodificado si el token es válido
   * @throws UnauthorizedError si el token es inválido, expirado o malformado
   * @description Valida firma, expiración, issuer y audience del token
   */
  verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.accessTokenSecret, {
        issuer: 'turnity-api',
        audience: 'turnity-app',
      }) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid access token');
    }
  }

  /**
   * Verifica y decodifica un token de renovación JWT
   * @param token - Token JWT de renovación a verificar
   * @returns Payload decodificado si el token es válido
   * @throws UnauthorizedError si el token es inválido, expirado o malformado
   * @description Valida firma, expiración, issuer y audience del refresh token
   */
  verifyRefreshToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.refreshTokenSecret, {
        issuer: 'turnity-api',
        audience: 'turnity-app',
      }) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }
  }
}
