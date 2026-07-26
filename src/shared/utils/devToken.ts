import { env } from '../config/env';

/**
 * Helper para exponer (o no) un token de verificacion/reset en la respuesta de
 * la API. Solo se expone FUERA de produccion y con EXPOSE_VERIFICATION_TOKENS=true,
 * pensado para poder probar el flujo por Postman mientras no hay frontend.
 *
 * En produccion NUNCA se expone (doble guarda: env.ts ademas prohibe el flag en
 * prod). Devuelve un objeto para hacer spread directo en el JSON de respuesta:
 *   res.json({ success: true, message, ...devTokenField(token) })
 */
export function devTokenField(token: string | undefined): { devToken?: string } {
  if (!token) return {};
  if (env.NODE_ENV === 'production' || !env.EXPOSE_VERIFICATION_TOKENS) return {};
  return { devToken: token };
}
