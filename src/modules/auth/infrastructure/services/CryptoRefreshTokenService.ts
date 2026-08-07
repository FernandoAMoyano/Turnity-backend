import { randomBytes, createHash } from 'node:crypto';
import {
  RefreshTokenService,
  GeneratedRefreshToken,
} from '../../application/services/RefreshTokenService';
import { env } from '../../../../shared/config/env';

/**
 * Implementación de RefreshTokenService usando el módulo `crypto` de Node.
 *
 * El token es aleatorio de 256 bits (32 bytes) codificado en base64url, y se
 * hashea con SHA-256 para persistirlo. SHA-256 porque el token ya es
 * de alta entropía; bcrypt/Argon2 (usados para passwords) solo agregarían
 * latencia sin beneficio de seguridad real en este caso.
 */
export class CryptoRefreshTokenService implements RefreshTokenService {
  /** Bytes de entropía del token opaco (32 = 256 bits) */
  private readonly tokenBytes = 32;

  /**
   * Genera un refresh token opaco nuevo y su hash
   * @returns `{ token, hash }` — `token` va al cliente, `hash` a la base
   */
  generate(): GeneratedRefreshToken {
    const token = randomBytes(this.tokenBytes).toString('base64url');
    const ttlMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);
    return { token, hash: this.hash(token), expiresAt };
  }

  /**
   * Calcula el hash SHA-256 (hex) de un token
   * @param token - Refresh opaco en claro
   * @returns Hash en hexadecimal
   */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
