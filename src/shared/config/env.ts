import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Schema de validacion de variables de entorno
 *
 * Solo incluye variables que el proceso Node realmente consume hoy.
 *
 * MAIL_* el EmailService (nodemailer) las usa
 * para verificacion de email + reset de password. Son requeridas en produccion
 * y opcionales en development/test (donde el transporte es mock/log y no se
 * exige SMTP a la suite/CI).
 *
 * Excluidas: DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/
 * DB_DATABASE (Prisma solo lee DATABASE_URL, las otras 5 solo las usa
 * docker-compose.dev.yml para configurar el contenedor de Postgres) y
 * PGADMIN_* (config del contenedor de pgAdmin, no de la app).
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
      .default('info'),

    DATABASE_URL: z.url({
      message: 'DATABASE_URL debe ser una URL valida (ej. postgresql://user:pass@host:port/db)',
    }),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
    JWT_ACCESS_EXPIRY: z
      .string()
      .regex(/^\d+[smhd]$/, "JWT_ACCESS_EXPIRY debe tener formato como '15m', '1h', '7d'")
      .default('15m'),
    JWT_REFRESH_EXPIRY: z
      .string()
      .regex(/^\d+[smhd]$/, "JWT_REFRESH_EXPIRY debe tener formato como '15m', '1h', '7d'")
      .default('7d'),

    // TTL del refresh token opaco (dias). El refresh ya no es JWT: se persiste
    // hasheado y este valor define su expiracion. JWT_REFRESH_EXPIRY queda como
    // legacy en deprecacion. -- F3/F6
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),

    // Config de la cookie httpOnly del refresh (y de la cookie CSRF). -- F5b/F6
    // COOKIE_SECURE: si no se define, se deriva de NODE_ENV (true solo en prod),
    // para permitir pruebas por HTTP en desarrollo local.
    // Los preprocess convierten string vacio ('') en undefined, para que dejar una
    // COOKIE_* vacia en el .env no rompa el boot y se aplique el default/derivado.
    COOKIE_SECURE: z
      .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional())
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    COOKIE_SAMESITE: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['strict', 'lax', 'none']).default('lax'),
    ),
    COOKIE_DOMAIN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

    FRONTEND_URL: z.url().default('http://localhost:3000'),

    // Mail / SMTP (nodemailer) -- consumidas por EmailService (verificacion de
    // email + reset de password). Opcionales aqui: en development/test el
    // transporte es mock/log; el superRefine de abajo las vuelve OBLIGATORIAS en
    // produccion. Los preprocess convierten '' en undefined para que una MAIL_*
    // vacia en el .env no rompa el boot y aplique el default cuando corresponda.
    MAIL_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    MAIL_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    MAIL_USER: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    MAIL_PASSWORD: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    // MAIL_FROM: puede venir como 'Nombre <noreply@app.com>', por eso string y no email.
    MAIL_FROM: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    // MAIL_SECURE: true => TLS directo (puerto 465); false => STARTTLS (587).
    MAIL_SECURE: z
      .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).default('false'))
      .transform((v) => v === 'true'),

    // TTL de los tokens de un solo uso (verificacion de email / reset de password).
    EMAIL_VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).default(24),
    PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).default(60),

    // Gatea el bloqueo de login cuando el email no esta verificado (403).
    // Default true. Poner en false permite login sin verificar (util en algunos entornos).
    REQUIRE_EMAIL_VERIFICATION: z
      .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).default('true'))
      .transform((v) => v === 'true'),

    // SOLO no-produccion: expone el token de verificacion/reset en la respuesta/log
    // para poder probar el flujo por Postman sin frontend. El superRefine prohibe
    // que sea true en produccion (doble guarda; el codigo tambien lo re-chequea).
    EXPOSE_VERIFICATION_TOKENS: z
      .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).default('false'))
      .transform((v) => v === 'true'),
  })
  .superRefine((val, ctx) => {
    // MAIL_* obligatorias en produccion: sin ellas el EmailService no puede enviar.
    if (val.NODE_ENV === 'production') {
      const requeridas = ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'] as const;
      for (const key of requeridas) {
        if (!val[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} es obligatoria en produccion (el EmailService la necesita)`,
          });
        }
      }
      // Nunca filtrar tokens por API/log en produccion.
      if (val.EXPOSE_VERIFICATION_TOKENS) {
        ctx.addIssue({
          code: 'custom',
          path: ['EXPOSE_VERIFICATION_TOKENS'],
          message: 'EXPOSE_VERIFICATION_TOKENS no puede ser true en produccion',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valida una fuente de variables de entorno contra el schema. Si falla,
 * imprime cada error de forma legible y termina el proceso -- antes de que
 * el servidor intente levantar el puerto o conectar a la base de datos.
 *
 * Recibe la fuente como parametro (default process.env) para poder testear
 * distintos escenarios sin depender de mutar process.env global ni de
 * jest.resetModules().
 *
 * Se usa console.error (no el logger de Winston) a proposito: este es el
 * primer punto de fallo posible en todo el arranque, antes de que cualquier
 * otra cosa de la app este garantizado que funcione.
 */
export const validateEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    console.error('\n❌ Error de configuración: variables de entorno inválidas o faltantes\n');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nRevisá tu archivo .env contra .env.example\n');
    process.exit(1);
  }

  return result.data as Env;
};

/** Variables de entorno validadas y tipadas, listas para consumir */
export const env = validateEnv();
