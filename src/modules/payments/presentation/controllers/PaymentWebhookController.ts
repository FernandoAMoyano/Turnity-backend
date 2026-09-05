import { Request, Response } from 'express';
import { HandleGatewayWebhook } from '../../application/use-cases/HandleGatewayWebhook';
import { logger } from '../../../../shared/logger/logger';

/**
 * Controlador del webhook de la pasarela de pago
 * @description Separado de `PaymentController`: la audiencia es
 * una máquina y no un usuario, el body es un `Buffer` crudo y
 * no JSON parseado, no hay usuario autenticado en el request, y el contrato de
 * error es el inverso al del resto de la API -- acá casi todo es 200.
 *
 * Mercado Pago reintenta cada 15 minutos
 * ante cualquier respuesta que no sea 200 o 201, y después del tercer intento
 * sigue reintentando con intervalos más largos (verificado contra la doc
 * vigente). Un 404 por un pago que no existe generaría un loop eterno por
 * algo que nunca va a resolverse. Solo se devuelve no-2xx cuando el reintento
 * puede ayudar.
 *
 * A diferencia del resto de los controllers, este no deja burbujear los
 * errores al `errorHandler` global: los atrapa y responde con el shape del
 * webhook (`{ received }`), para que el proveedor reciba siempre el mismo
 * contrato. El log del error sí se mantiene, con el mismo nivel que usaría el
 * handler global.
 */
export class PaymentWebhookController {
  constructor(private _handleGatewayWebhook: HandleGatewayWebhook) {}

  /**
   * Procesa una notificación de webhook de Mercado Pago
   * @route POST /payments/webhooks/mercadopago
   * @param req - Request sin autenticar, con el body crudo (`Buffer`) que
   * produce el `express.raw` propio de `PaymentWebhookRoutes`, el header
   * `x-signature`, el header `x-request-id` y el query param `data.id`
   * @param res - Response de Express
   * @returns Promise con la respuesta enviada
   * @responseStatus 200 - Notificación procesada, duplicada o descartada:
   * cualquier desenlace terminal que no amerite reintento
   * @responseStatus 401 - Firma ausente, malformada, inválida, `ts` fuera de
   * la ventana de tolerancia, o body no recibido como `Buffer`. Sin detalle
   * del motivo: explicarle a quien firma mal por qué falló es ayudarlo a
   * acertar
   * @responseStatus 500 - Fallo transitorio (la pasarela no responde, la base
   * no acepta la escritura) -> el reintento de la pasarela puede ayudar
   */
  async handleMercadoPago(req: Request, res: Response): Promise<Response> {
    // El body tiene que llegar como Buffer. Si no lo es, el `express.raw` no
    // matcheó el Content-Type (Express deja `{}` en ese caso) y no hay nada
    // crudo que verificar ni auditar. Se responde 401 y no 415 para no
    // ampliar el contrato del endpoint ni darle a un atacante una forma de
    // distinguir "content-type equivocado" de "firma equivocada".
    if (!Buffer.isBuffer(req.body)) {
      logger.warn('[PaymentWebhookController] notificación sin body crudo, se rechaza', {
        contentType: req.header('content-type'),
      });
      return res.status(401).json({
        received: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
      });
    }

    try {
      const result = await this._handleGatewayWebhook.execute({
        rawBody: req.body,
        xSignature: req.header('x-signature'),
        xRequestId: req.header('x-request-id'),
        dataId: this.readDataId(req),
      });

      if (result.outcome === 'unauthorized') {
        return res.status(401).json({
          received: false,
          code: 'UNAUTHORIZED',
          message: 'Invalid webhook signature',
        });
      }

      if (result.outcome === 'retryable') {
        return res.status(500).json({
          received: false,
          code: 'WEBHOOK_PROCESSING_FAILED',
          message: 'Could not process the notification. Please retry.',
        });
      }

      // processed | duplicate | ignored -> las tres son terminales
      return res.status(200).json({ received: true });
    } catch (error) {
      // Cualquier fallo que el caso de uso no previó. Se responde 500 a
      // propósito: no sabemos si es transitorio, y dejar que la pasarela
      // reintente es preferible a perder la notificación en silencio.
      logger.error('[PaymentWebhookController] fallo inesperado procesando el webhook', {
        requestId: req.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.status(500).json({
        received: false,
        code: 'WEBHOOK_PROCESSING_FAILED',
        message: 'Could not process the notification. Please retry.',
      });
    }
  }

  /**
   * Extrae el `data.id` de la query string
   * @description Mercado Pago lo manda como `?type=payment&data.id=<id>`, y
   * es uno de los tres valores que entran en el manifest de la firma. El
   * parser de query de Express lo deja accesible con la clave literal
   * `'data.id'` (el punto no es notación especial para `qs` con la
   * configuración por defecto). Se normaliza a `string | undefined` porque el
   * tipo de Express admite arrays y objetos anidados, y el puerto espera un
   * escalar sin normalizar.
   * @param req - Request del webhook
   * @returns El `data.id` como string, o `undefined` si no vino o no es un
   * escalar
   */
  private readDataId(req: Request): string | undefined {
    const value = req.query['data.id'];
    return typeof value === 'string' ? value : undefined;
  }
}
