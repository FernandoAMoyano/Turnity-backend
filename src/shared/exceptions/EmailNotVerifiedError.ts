import { AppError } from './AppError';

/**
 * Error para intentos de login de un usuario cuyo email todavia no fue verificado,
 * cuando REQUIRE_EMAIL_VERIFICATION esta activo.
 *
 * Responde 403 con code 'EMAIL_NOT_VERIFIED' para que el cliente pueda distinguir
 * este caso (ej. ofrecer reenviar el email de verificacion) de unas credenciales
 * incorrectas (401). Se lanza SOLO despues de validar las credenciales, para no
 * filtrar el estado de verificacion a quien no conoce la password.
 */
export class EmailNotVerifiedError extends AppError {
  constructor(
    message: string = 'Email not verified. Please verify your email before logging in',
  ) {
    super(message, 403, 'EMAIL_NOT_VERIFIED');
    this.name = 'EmailNotVerifiedError';
  }
}
