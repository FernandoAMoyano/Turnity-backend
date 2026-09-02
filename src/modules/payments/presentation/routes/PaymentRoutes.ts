import { Router, Request, Response, NextFunction } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { AuthMiddleware } from '../../../auth/presentation/middleware/AuthMiddleware';
import { PaymentValidations } from '../validations/PaymentValidations';
import { ValidationMiddleware } from '../../../../shared/middleware/ValidationMiddleware';

/**
 * Configurador de rutas para el módulo de pagos
 * @description Organiza todas las rutas relacionadas con pagos
 */
export class PaymentRoutes {
  private router: Router;

  constructor(
    private paymentController: PaymentController,
    private authMiddleware: AuthMiddleware,
  ) {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * Configura todas las rutas del módulo de pagos
   * @routes
   * - GET /payments - Listar todos los pagos (admin)
   * - GET /payments/statistics - Obtener estadísticas (admin)
   * - GET /payments/appointment/:appointmentId - Pagos de una cita (admin,
   *   stylist dueño de la cita, client dueño de la cita -- F18)
   * - GET /payments/:id - Obtener pago por ID (admin, stylist dueño -- F18)
   * - POST /payments - Crear pago (admin, stylist)
   * - POST /payments/checkout - Abrir checkout contra la pasarela (admin, stylist dueño,
   *   client dueño -- amplía F18 solo para esta ruta)
   * - POST /payments/:id/process - Procesar pago (admin, stylist dueño -- F18)
   * - POST /payments/:id/refund - Reembolsar pago (admin)
   * - POST /payments/:id/cancel - Cancelar pago (admin, stylist dueño -- F18)
   * - PUT /payments/:id - Actualizar pago (admin)
   */
  private setupRoutes(): void {
    // ==========================================
    // RUTAS BASE (/) - PRIMERO
    // ==========================================

    // GET / - Listar todos los pagos (admin only)
    this.router.get(
      '/',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN']),
      PaymentValidations.getPayments,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.getAll(req, res).catch(next);
      },
    );

    // POST / - Crear pago (admin, stylist)
    this.router.post(
      '/',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN', 'STYLIST']),
      PaymentValidations.createPayment,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.create(req, res).catch(next);
      },
    );

    // ==========================================
    // RUTAS ESPECÍFICAS (sin parámetros dinámicos)
    // ==========================================

    // POST /checkout - Abrir checkout contra la pasarela de pago (admin,
    // stylist dueño, client dueño -- D1 del plan de la pasarela de pago,
    // amplía F18 solo para esta ruta). Antes de /:id: sin este orden,
    // Express la capturaría como /:id con id="checkout" y fallaría la
    // validación de UUID (misma convención ya documentada en este archivo).
    this.router.post(
      '/checkout',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN', 'STYLIST', 'CLIENT']),
      PaymentValidations.createCheckout,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.createCheckout(req, res).catch(next);
      },
    );

    // GET /statistics - Estadísticas de pagos (admin only)
    this.router.get(
      '/statistics',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN']),
      PaymentValidations.getStatistics,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.getStatistics(req, res).catch(next);
      },
    );

    // GET /appointment/:appointmentId - Pagos de una cita (admin, stylist dueño, client dueño -- F18)
    this.router.get(
      '/appointment/:appointmentId',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN', 'STYLIST', 'CLIENT']),
      PaymentValidations.paymentsByAppointment,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.getByAppointment(req, res).catch(next);
      },
    );

    // ==========================================
    // RUTAS CON PARÁMETROS DINÁMICOS - AL FINAL
    // ==========================================

    // GET /:id - Obtener pago por ID (admin, stylist)
    this.router.get(
      '/:id',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN', 'STYLIST']),
      PaymentValidations.paymentById,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.getById(req, res).catch(next);
      },
    );

    // PUT /:id - Actualizar pago (admin only)
    this.router.put(
      '/:id',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN']),
      PaymentValidations.updatePayment,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.update(req, res).catch(next);
      },
    );

    // POST /:id/process - Procesar pago (admin, stylist)
    this.router.post(
      '/:id/process',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN', 'STYLIST']),
      PaymentValidations.processPayment,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.process(req, res).catch(next);
      },
    );

    // POST /:id/refund - Reembolsar pago (admin only)
    this.router.post(
      '/:id/refund',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN']),
      PaymentValidations.refundPayment,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.refund(req, res).catch(next);
      },
    );

    // POST /:id/cancel - Cancelar pago (admin, stylist)
    this.router.post(
      '/:id/cancel',
      this.authMiddleware.authenticate.bind(this.authMiddleware),
      this.authMiddleware.authorize(['ADMIN', 'STYLIST']),
      PaymentValidations.paymentById,
      ValidationMiddleware.handleValidationErrors,
      (req: Request, res: Response, next: NextFunction) => {
        this.paymentController.cancel(req, res).catch(next);
      },
    );
  }

  /**
   * Obtiene el router configurado
   * @returns Router de Express con todas las rutas configuradas
   */
  getRouter(): Router {
    return this.router;
  }
}
