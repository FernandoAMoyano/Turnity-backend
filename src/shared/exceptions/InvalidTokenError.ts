import { AppError } from './AppError';

/**
 * Error para tokens de un solo uso (verificacion de email / reset de password)
 * que no son validos: inexistentes, de otro tipo, ya consumidos o expirados.
 *
 * Responde 400 con code 'INVALID_OR_EXPIRED_TOKEN' para que el cliente pueda
 * distinguir este caso (ej. ofrecer reenviar el enlace) sin filtrar por que
 * exactamente fallo (no se distingue inexistente de expirado, a proposito).
 */
export class InvalidTokenError extends AppError {
  constructor(message: string = 'El enlace es invalido o expiro') {
    super(message, 400, 'INVALID_OR_EXPIRED_TOKEN');
    this.name = 'InvalidTokenError';
  }
}
