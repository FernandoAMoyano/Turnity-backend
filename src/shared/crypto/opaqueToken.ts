import { randomBytes, createHash } from 'node:crypto';

/**
 * Utilidades para tokens opacos de un solo uso (verificacion de email, reset de
 * password). Mismo patron que los refresh tokens de sesion: el valor en claro
 * es de alta entropia y se entrega al usuario; en la base solo se guarda su
 * hash SHA-256. SHA-256 (y no bcrypt/Argon2) porque el token ya es aleatorio de
 * alta entropia: hashearlo con un KDF lento solo agregaria latencia sin ganar
 * seguridad real.
 *
 * Helper compartido para no duplicar la cripto entre servicios ni acoplar el
 * `CryptoRefreshTokenService` existente (se deja intacto).
 */

/** Bytes de entropia por defecto del token opaco (32 = 256 bits) */
const DEFAULT_TOKEN_BYTES = 32;

/**
 * Genera un token opaco aleatorio codificado en base64url.
 * @param bytes - Bytes de entropia (default 32 = 256 bits)
 * @returns Token en claro, para entregar al usuario (nunca persistir)
 */
export function generateOpaqueToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Calcula el hash SHA-256 (hex) de un token, para persistir y comparar.
 * @param token - Token opaco en claro
 * @returns Hash en hexadecimal
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
