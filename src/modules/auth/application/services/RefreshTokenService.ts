/**
 * Resultado de generar un refresh token opaco.
 * `token` se entrega al cliente (vía cookie httpOnly); `hash` es lo único
 * que se persiste en la base (nunca el token en claro).
 */
export interface GeneratedRefreshToken {
  /** Token opaco de alta entropía, entregado al cliente */
  token: string;
  /** SHA-256 del token, para persistir y comparar */
  hash: string;
  /** Momento de expiración calculado a partir del TTL configurado */
  expiresAt: Date;
}

/**
 * Puerto para la generación y hashing de refresh tokens opacos.
 * A diferencia del access (JWT firmado), el refresh es aleatorio y revocable,
 * por lo que solo se guarda su hash.
 */
export interface RefreshTokenService {
  /**
   * Genera un refresh token opaco nuevo junto con su hash
   * @returns `{ token, hash }`
   */
  generate(): GeneratedRefreshToken;

  /**
   * Calcula el hash de un token recibido, para buscarlo/compararlo en la base
   * @param token - Refresh opaco en claro
   * @returns Hash SHA-256 en hexadecimal
   */
  hash(token: string): string;
}
