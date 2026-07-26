import { rateLimit, Options } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { TooManyRequestsError } from '../exceptions/TooManyRequestsError';

/**
 * Handler compartido para los 3 rate limiters de auth
 *
 * En vez de dejar que express-rate-limit responda directamente, se delega
 * el error al pipeline existente (next(error) -> errorHandler) para que el
 * 429 tenga el mismo formato JSON que cualquier otro error de la API y quede
 * registrado por el logger de Winston con su requestId correspondiente.
 */
const rateLimitHandler = (message: string) => {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next(new TooManyRequestsError(message));
  };
};

/**
 * Opciones compartidas por los 3 limiters de auth
 *
 * skip: se desactiva por completo en NODE_ENV=test -- mismo criterio ya usado
 * por morgan (app.ts) y por el logger de Winston (logger.ts). Sin esto, la
 * suite de tests (que loguea/registra decenas de veces contra los mismos
 * endpoints en la misma corrida) empezaria a fallar con 429 falsos positivos.
 */
const baseOptions: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
};

/**
 * Configuracion del limiter de POST /auth/login -- protección contra fuerza bruta
 *
 * skipSuccessfulRequests: true es la pieza clave: solo los intentos FALLIDOS
 * consumen el límite. Un usuario legítimo que loguea correctamente nunca gasta
 * su cupo; solo lo gasta quien esta probando contraseñas repetidamente.
 *
 * Exportada por separado (no solo el middleware ya construido) para que los
 * tests puedan instanciar limiters frescos con esta misma configuracion, sin
 * compartir el contador interno del singleton usado en produccion.
 */
export const loginRateLimiterOptions: Partial<Options> = {
  ...baseOptions,
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 5,
  skipSuccessfulRequests: true,
  handler: rateLimitHandler('Too many login attempts, please try again in 15 minutes'),
};

/**
 * Configuracion del limiter de POST /auth/register -- protección contra spam de registros
 *
 * Sin skipSuccessfulRequests: aca cualquier intento (exitoso o no) es lo que
 * se quiere limitar, no solo los fallidos.
 */
export const registerRateLimiterOptions: Partial<Options> = {
  ...baseOptions,
  windowMs: 60 * 60 * 1000, // 60 minutos
  limit: 10,
  handler: rateLimitHandler('Too many registration attempts, please try again later'),
};

/**
 * Configuracion del limiter de POST /auth/refresh-token
 *
 * Umbral mas permisivo a proposito: un usuario real con varias pestañas o
 * dispositivos activos refresca tokens con cierta frecuencia como parte de
 * uso normal. Este limite solo topea abuso real, no uso legitimo.
 */
export const refreshTokenRateLimiterOptions: Partial<Options> = {
  ...baseOptions,
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 20,
  handler: rateLimitHandler('Too many token refresh attempts, please try again later'),
};

/**
 * Configuracion del limiter de POST /auth/resend-verification y
 * POST /auth/forgot-password -- frena el abuso de reenvio de emails (spam a la
 * casilla de un tercero) y el sondeo de la API. Umbral bajo (3/hora por IP) a
 * proposito: reenviar/recuperar es una accion poco frecuente para un usuario real.
 *
 * Store en memoria (como el resto): sirve para una sola instancia; migrar a un
 * store distribuido queda como deuda para multi-instancia.
 */
export const resendVerificationRateLimiterOptions: Partial<Options> = {
  ...baseOptions,
  windowMs: 60 * 60 * 1000, // 60 minutos
  limit: 3,
  handler: rateLimitHandler('Too many requests, please try again later'),
};

/** Rate limiter para POST /auth/login, usado en AuthRoutes.ts */
export const loginRateLimiter = rateLimit(loginRateLimiterOptions);

/** Rate limiter para POST /auth/register, usado en AuthRoutes.ts */
export const registerRateLimiter = rateLimit(registerRateLimiterOptions);

/** Rate limiter para POST /auth/refresh-token, usado en AuthRoutes.ts */
export const refreshTokenRateLimiter = rateLimit(refreshTokenRateLimiterOptions);

/** Rate limiter para reenvio de verificacion / forgot-password, usado en AuthRoutes.ts */
export const resendVerificationRateLimiter = rateLimit(resendVerificationRateLimiterOptions);
