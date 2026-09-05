import express, { Router, Request, Response, NextFunction } from 'express';
import { PaymentWebhookController } from '../controllers/PaymentWebhookController';
import { logger } from '../../../../shared/logger/logger';

/**
 * Límite del body del webhook
 * @description 1 MB, contra los 10 MB del `express.json` global. Es un
 * endpoint público sin autenticación: cuanto más chico el límite, menos
 * superficie. Una notificación real de Mercado Pago pesa unos cientos de
 * bytes.
 */
const WEBHOOK_BODY_LIMIT = '1mb';

/**
 * Configurador de rutas del webhook de la pasarela de pago
 * @description Router aparte del de `payments`, y la razón es la lista de lo
 * que NO tiene:
 *
 * - **Sin `authenticate` ni `authorize`**: la pasarela no tiene un JWT
 *   nuestro. `AuthMiddleware` se aplica por ruta en todo el repo, nunca
 *   global, así que basta con no agregarlo acá.
 * - **Sin `csrfProtection`**: no se importa. Un proveedor externo jamás va a
 *   mandar la cookie `csrfToken` ni el header `X-CSRF-Token`, así que si esta
 *   ruta pasara por ahí fallaría con 403 en todos los ambientes, siempre.
 * - **Sin rate limiter**: no se importa. Mercado Pago reintenta en ráfaga
 *   ante un fallo y un 429 agravaría el loop; además, detrás del proxy de
 *   Render un limiter por IP vería toda la carga como un solo cliente. La
 *   protección real es el HMAC (rechaza antes de cualquier I/O), el límite de
 *   1 MB y la deduplicación por `@unique` en la base.
 * - **Sin `express-validator`**: `ValidationMiddleware` asume un body ya
 *   parseado, y acá el body es un `Buffer`. La validación del contenido la
 *   hace `parseWebhookNotification` en el adapter.
 *
 * Y lo que sí tiene, que es la razón por la que este router se monta antes
 * que el `express.json` global en `app.ts`: su propio `express.raw`.
 */
export class PaymentWebhookRoutes {
  private router: Router;

  constructor(private paymentWebhookController: PaymentWebhookController) {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * Configura las rutas del webhook
   * @routes
   * - POST /payments/webhooks/mercadopago - Recibir notificación de Mercado
   *   Pago (público, autenticado por firma HMAC)
   */
  private setupRoutes(): void {
    // POST /mercadopago - Notificación de Mercado Pago.
    //
    // El proveedor va en el path en vez de un `/webhooks` genérico: permite
    // agregar un segundo proveedor sin ambigüedad y sin sniffear headers para
    // saber qué verificador de firma usar.
    //
    // `express.raw` con `type: 'application/json'` deja el body como Buffer
    // en vez de parsearlo. Mercado Pago no firma el cuerpo (su manifest es
    // `id:{data.id};request-id:{x-request-id};ts:{ts};`), así que esto no es
    // un requisito del HMAC; sí lo es de las otras tres cosas: el límite
    // acotado de arriba, el `rawPayload` byte-exacto que se persiste para
    // auditoría y reproceso, y que el puerto `IPaymentGateway` siga siendo
    // agnóstico del proveedor (Stripe, GitHub y Shopify sí firman el cuerpo,
    // y con este diseño un adapter para ellos entra sin tocar la ruta).
    this.router.post(
      '/mercadopago',
      express.raw({ type: 'application/json', limit: WEBHOOK_BODY_LIMIT }),
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentWebhookController.handleMercadoPago(req, res).catch(next);
      },
    );

    // Manejo de errores propio del router, registrado después de las rutas.
    this.router.use(this.handleBodyParserError);
  }

  /**
   * Traduce los errores del `express.raw` de este router a la respuesta del
   * webhook
   * @description Existe porque el `errorHandler` global solo respeta el
   * status de las excepciones que extienden `AppError`: un error de
   * `body-parser` (que trae `status: 413` y `type: 'entity.too.large'`)
   * terminaría respondiendo 500, y un 500 le dice a la pasarela "reintentá",
   * cuando un payload demasiado grande va a fallar igual en cada reintento.
   * Se resuelve acá, dentro del router, en vez de tocar el `errorHandler`
   * global: el cambio queda contenido en el módulo y no altera el
   * comportamiento de errores de ninguna otra ruta de la API.
   *
   * Cualquier error que no sea de parseo se delega al handler global con
   * `next(error)`, sin cambiarle nada.
   * @param error - Error propagado por el `express.raw` o por la ruta
   * @param req - Request de la notificación
   * @param res - Response de Express
   * @param next - Continuación hacia el `errorHandler` global
   */
  private handleBodyParserError = (
    error: Error & { status?: number; type?: string },
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (error.type === 'entity.too.large') {
      logger.warn('[PaymentWebhookRoutes] notificación rechazada por exceder el límite de body', {
        requestId: req.id,
        limit: WEBHOOK_BODY_LIMIT,
      });
      res.status(413).json({
        received: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `Webhook payload exceeds the ${WEBHOOK_BODY_LIMIT} limit`,
      });
      return;
    }

    if (error.type === 'entity.parse.failed') {
      // JSON inválido detectado por body-parser. Con `express.raw` no debería
      // pasar (no parsea nada), pero se cubre igual: es terminal, así que 200
      // -- reintentar el mismo payload roto no cambiaría nada, y este caso ya
      // queda registrado por el log.
      logger.warn('[PaymentWebhookRoutes] notificación con body ilegible, se descarta', {
        requestId: req.id,
      });
      res.status(200).json({ received: true });
      return;
    }

    next(error);
  };

  /**
   * Obtiene el router configurado
   * @returns Router de Express con las rutas del webhook configuradas
   */
  getRouter(): Router {
    return this.router;
  }
}
