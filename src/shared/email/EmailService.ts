/**
 * Puerto del servicio de email (verificacion de cuenta + reset de password).
 *
 * el envio de mail es transversal: hoy lo consume el
 * modulo `auth`, y a futuro puede reutilizarlo `notifications` (que hoy solo
 * persiste en DB) sin acoplar modulos entre si. La implementacion concreta
 * (nodemailer) esta en `NodemailerEmailService`; el resto de la app depende
 * solo de esta interfaz.
 */

/** Contexto para el email de verificacion de cuenta */
export interface VerificationEmailContext {
  /** Destinatario */
  to: string;
  /** Nombre del usuario, para el saludo */
  name: string;
  /** URL completa de verificacion (FRONTEND_URL/verify-email?token=...) */
  verificationUrl: string;
  /** Vigencia del enlace, en horas, para mostrar al usuario */
  expiresInHours: number;
}

/** Contexto para el email de recuperacion de password */
export interface PasswordResetEmailContext {
  /** Destinatario */
  to: string;
  /** Nombre del usuario, para el saludo */
  name: string;
  /** URL completa de reset (FRONTEND_URL/reset-password?token=...) */
  resetUrl: string;
  /** Vigencia del enlace, en minutos, para mostrar al usuario */
  expiresInMinutes: number;
}

/**
 * Servicio de envio de emails transaccionales.
 *
 * Las implementaciones NO deben lanzar si el envio es best-effort (ver
 * politica de registro); el caller decide como tratar los fallos. En test el
 * transporte es un mock que no envia nada (ver `transportFactory`).
 */
export interface EmailService {
  /** Envia el email con el enlace de verificacion de cuenta */
  sendVerificationEmail(ctx: VerificationEmailContext): Promise<void>;

  /** Envia el email con el enlace de recuperacion de password */
  sendPasswordResetEmail(ctx: PasswordResetEmailContext): Promise<void>;
}
