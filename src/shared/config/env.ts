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

    // DIRECT_URL: usada por el motor de migraciones de Prisma (migrate/db
    // push), no por el cliente en runtime -- ver comentario en
    // schema.prisma. Gap preexistente cerrado en F2: antes no se validaba en
    // absoluto, pese a que docker-entrypoint.sh corre `migrate deploy` contra
    // ella en cada arranque del contenedor. Obligatoria como DATABASE_URL: en
    // todo ambiente real (dev, CI, Render) ya se define explicita (ver
    // .env.example / .env.production.example / ci.yml).
    DIRECT_URL: z.url({
      message:
        'DIRECT_URL debe ser una URL valida (ej. postgresql://user:pass@host:port/db) -- la usa prisma migrate/db push, ver comentario en schema.prisma',
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

    // Pasarela de pago (Mercado Pago) -- F2. 'none' mantiene el proyecto
    // arrancable sin credenciales (dev, CI, cualquiera que clone el repo):
    // NoopPaymentGateway rechaza checkout/refund con 422 y el webhook
    // responde 401 siempre. El superRefine de abajo exige credenciales cuando
    // se activa 'mercadopago'.
    PAYMENT_GATEWAY_PROVIDER: z.enum(['none', 'mercadopago']).default('none'),
    // Access token de la cuenta de Mercado Pago. Empieza con TEST- en
    // sandbox, APP_USR- en produccion (ver isSandbox en MercadoPagoGateway).
    MERCADOPAGO_ACCESS_TOKEN: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(20).optional(),
    ),
    // Secreto para verificar la firma x-signature de los webhooks (panel de MP).
    MERCADOPAGO_WEBHOOK_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(16).optional(),
    ),
    // Moneda de los cobros, ISO 4217 (ej. ARS, BRL, MXN).
    PAYMENT_CURRENCY: z.string().length(3).default('ARS'),
    // URL publica de esta API, usada para armar notification_url/back_urls de
    // la preferencia de pago. Obligatoria si PAYMENT_GATEWAY_PROVIDER=mercadopago.
    PUBLIC_API_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    // Ventana de tolerancia (segundos) para el 'ts' de la firma del webhook --
    // mitiga el replay de una notificacion valida capturada.
    PAYMENT_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS: z.coerce.number().int().min(30).default(300),
    // Timeout (ms) de las llamadas HTTP al gateway.
    PAYMENT_GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
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

    // Pasarela de pago: credenciales obligatorias solo si esta activa (§7.2 del plan).
    if (val.PAYMENT_GATEWAY_PROVIDER === 'mercadopago') {
      const requeridas = [
        'MERCADOPAGO_ACCESS_TOKEN',
        'MERCADOPAGO_WEBHOOK_SECRET',
        'PUBLIC_API_URL',
      ] as const;
      for (const key of requeridas) {
        if (!val[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} es obligatoria cuando PAYMENT_GATEWAY_PROVIDER=mercadopago`,
          });
        }
      }

      // Nunca cobrar de verdad con credenciales de sandbox (mismo criterio
      // que la guarda de EXPOSE_VERIFICATION_TOKENS de arriba).
      if (val.NODE_ENV === 'production' && val.MERCADOPAGO_ACCESS_TOKEN?.startsWith('TEST-')) {
        ctx.addIssue({
          code: 'custom',
          path: ['MERCADOPAGO_ACCESS_TOKEN'],
          message: 'MERCADOPAGO_ACCESS_TOKEN no puede empezar con TEST- en produccion',
        });
      }
    }

    // PUBLIC_API_URL debe ser https en produccion, si esta seteada (la
    // obligatoriedad de que exista, cuando corresponde, ya la exige el bloque
    // de arriba -- este chequeo es solo sobre el esquema).
    if (
      val.NODE_ENV === 'production' &&
      val.PUBLIC_API_URL &&
      !val.PUBLIC_API_URL.startsWith('https://')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_API_URL'],
        message: 'PUBLIC_API_URL debe ser https:// en produccion',
      });
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
