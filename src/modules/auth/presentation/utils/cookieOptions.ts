import { CookieOptions } from 'express';
import { env } from '../../../../shared/config/env';

/**
 * Nombres y atributos centralizados de las cookies de autenticación.
 *
 * - refreshToken: httpOnly (no legible por JS), acotada al path de auth.
 *   Transporta el refresh opaco (OWASP OAuth for Browser-Based Apps).
 * - csrfToken: NO httpOnly (legible por JS), para el patrón double-submit
 *   contra CSRF. El front la lee y la reenvía en el header X-CSRF-Token.
 */
export const REFRESH_COOKIE_NAME = 'refreshToken';
export const CSRF_COOKIE_NAME = 'csrfToken';

/** Path al que se acota la cookie de refresh (solo se envía a /api/v1/auth) */
export const AUTH_COOKIE_PATH = '/api/v1/auth';

/**
 * `secure` efectivo: si COOKIE_SECURE está seteado se respeta; si no, se activa
 * solo en producción. Así en desarrollo local (HTTP) las cookies funcionan.
 */
const secure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
const domain = env.COOKIE_DOMAIN;

/** Vida de la cookie en ms, alineada al TTL del refresh */
const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Atributos base de la cookie de refresh (sin maxAge, para poder reutilizar en clear) */
function baseRefreshOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: env.COOKIE_SAMESITE,
    path: AUTH_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };
}

/** Atributos base de la cookie CSRF (legible por JS, disponible en todo el sitio) */
function baseCsrfOptions(): CookieOptions {
  return {
    httpOnly: false,
    secure,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

/** Opciones para SETEAR la cookie de refresh (incluye maxAge) */
export function refreshCookieOptions(): CookieOptions {
  return { ...baseRefreshOptions(), maxAge };
}

/** Opciones para BORRAR la cookie de refresh (mismo path/domain, sin maxAge) */
export function refreshClearOptions(): CookieOptions {
  return baseRefreshOptions();
}

/** Opciones para SETEAR la cookie CSRF (incluye maxAge) */
export function csrfCookieOptions(): CookieOptions {
  return { ...baseCsrfOptions(), maxAge };
}

/** Opciones para BORRAR la cookie CSRF */
export function csrfClearOptions(): CookieOptions {
  return baseCsrfOptions();
}
