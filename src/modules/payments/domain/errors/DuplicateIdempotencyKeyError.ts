import { ConflictError } from '../../../../shared/exceptions/ConflictError';

/**
 * Error que se lanza al guardar un pago con una clave de idempotencia que ya
 * tiene otro pago
 * @description Lo lanza el repositorio cuando la base rechaza la clave por
 * duplicada. Pasa cuando dos pedidos con la misma clave llegan al mismo tiempo
 * y ninguno encuentra el pago del otro antes de guardar el suyo: quien guarda
 * puede atraparlo y buscar el pago que se guardó primero. Si se escapa sin
 * manejar, responde 409 en vez de un error interno.
 */
export class DuplicateIdempotencyKeyError extends ConflictError {
  constructor() {
    super('A payment with this idempotency key already exists');
  }
}
