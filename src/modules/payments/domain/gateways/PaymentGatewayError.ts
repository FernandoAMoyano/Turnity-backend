/**
 * Error de una llamada saliente a la pasarela de pago
 * @description Lo lanzan los adapters cuando el proveedor responde con un
 * status HTTP de error o cuando la llamada no llega a completarse. Conserva el
 * status del proveedor para que los casos de uso puedan distinguir un fallo
 * pasajero de uno que no se resuelve reintentando, sin conocer los detalles de
 * cada proveedor.
 */
export class PaymentGatewayError extends Error {
  /**
   * @param message - Descripción del fallo, para logs. No se expone en las respuestas de la API.
   * @param providerStatus - Status HTTP que respondió el proveedor. Sin valor
   * cuando la llamada falló antes de obtener una respuesta (error de red o timeout).
   */
  constructor(
    message: string,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }

  /**
   * Indica si el fallo puede resolverse reintentando más tarde
   * @returns true ante un error de red o un status 5xx del proveedor
   */
  get isRetryable(): boolean {
    return this.providerStatus === undefined || this.providerStatus >= 500;
  }

  /**
   * Indica si el proveedor rechazó las credenciales con las que se lo llamó
   * @returns true ante un status 401 o 403 del proveedor
   */
  get isCredentialsError(): boolean {
    return this.providerStatus === 401 || this.providerStatus === 403;
  }
}
