import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../logger/logger';

/**
 * Crea el transporte de nodemailer segun el entorno. Mismo criterio con que
 * morgan y el logger se auto-ajustan por NODE_ENV:
 *
 * - test: `jsonTransport` -> NO envia nada; serializa el mensaje a JSON para
 *   poder inspeccionarlo. Garantiza que la suite/CI nunca manden mails reales.
 * - development sin MAIL_HOST: mismo `jsonTransport` + aviso por log. Permite
 *   desarrollar y probar por API/Postman sin configurar un SMTP.
 * - development con MAIL_HOST / production: SMTP real. En produccion las MAIL_*
 *   son obligatorias (validado en env.ts).
 */
export function createEmailTransport(): Transporter {
  if (env.NODE_ENV === 'test') {
    return nodemailer.createTransport({ jsonTransport: true });
  }

  if (env.NODE_ENV === 'development' && !env.MAIL_HOST) {
    logger.warn(
      '[email] MAIL_HOST no configurado en desarrollo: usando transporte de log ' +
        '(no se envian mails reales; el enlace se loguea para pruebas por API).',
    );
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    auth:
      env.MAIL_USER && env.MAIL_PASSWORD
        ? { user: env.MAIL_USER, pass: env.MAIL_PASSWORD }
        : undefined,
  });
}

/**
 * Indica si el transporte activo realmente entrega mails (SMTP) o es el mock
 * de log/test. Sirve para decidir si conviene loguear el enlace en claro.
 */
export function isRealTransport(): boolean {
  if (env.NODE_ENV === 'test') return false;
  if (env.NODE_ENV === 'development' && !env.MAIL_HOST) return false;
  return true;
}
