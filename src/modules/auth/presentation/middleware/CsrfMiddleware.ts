import { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';
import { CSRF_COOKIE_NAME } from '../utils/cookieOptions';

/** Header en el que el cliente reenvía el token CSRF (patrón double-submit) */
const CSRF_HEADER = 'X-CSRF-Token';

/**
 * Genera un token CSRF opaco de alta entropía
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Comparación en tiempo constante de dos strings (evita timing attacks)
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Middleware de protección CSRF con el patrón double-submit cookie.
 *
 * Aplica a los endpoints que autentican vía cookie (refresh, logout, logout-all):
 * requiere que el valor del header `X-CSRF-Token` coincida con la cookie
 * `csrfToken`. Un sitio atacante puede provocar el envío de la cookie, pero no
 * puede leerla (ni setear el header con su valor) por la Same-Origin Policy.
 *
 * El resto de la API no lo necesita porque usa el access token vía Bearer.
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  const cookieToken: string | undefined = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    next(new ForbiddenError('Invalid or missing CSRF token'));
    return;
  }

  next();
};
