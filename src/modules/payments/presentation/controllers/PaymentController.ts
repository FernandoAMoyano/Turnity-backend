import { Response } from 'express';
import { CreatePayment } from '../../application/use-cases/CreatePayment';
import { CreateCheckout } from '../../application/use-cases/CreateCheckout';
import { GetPaymentById } from '../../application/use-cases/GetPaymentById';
import { GetPaymentsByAppointment } from '../../application/use-cases/GetPaymentsByAppointment';
import { GetPayments } from '../../application/use-cases/GetPayments';
import { ProcessPayment } from '../../application/use-cases/ProcessPayment';
import { RefundPayment } from '../../application/use-cases/RefundPayment';
import { CancelPayment } from '../../application/use-cases/CancelPayment';
import { GetPaymentStatistics } from '../../application/use-cases/GetPaymentStatistics';
import { UpdatePayment } from '../../application/use-cases/UpdatePayment';
import { PaymentMethodEnum, PaymentStatusEnum } from '../../domain/entities/Payment';
import { AuthenticatedRequest } from '../../../auth/presentation/middleware/AuthMiddleware';
import { UnauthorizedError } from '../../../../shared/exceptions/UnauthorizedError';

/**
 * Controlador para el módulo de pagos
 * @description Maneja las peticiones HTTP relacionadas con pagos
 * Los errores burbujean al errorHandler global via .catch(next) en PaymentRoutes
 */
export class PaymentController {
  constructor(
    private _createPayment: CreatePayment,
    private _createCheckout: CreateCheckout,
    private _getPaymentById: GetPaymentById,
    private _getPaymentsByAppointment: GetPaymentsByAppointment,
    private _getPayments: GetPayments,
    private _processPayment: ProcessPayment,
    private _refundPayment: RefundPayment,
    private _cancelPayment: CancelPayment,
    private _getPaymentStatistics: GetPaymentStatistics,
    private _updatePayment: UpdatePayment,
  ) {}

  /**
   * Crea un nuevo pago
   * @route POST /payments
   * @param req - Request autenticado con datos del pago en el body
   * @param res - Response de Express
   * @returns Promise con el pago creado
   * @responseStatus 201 - Pago creado exitosamente
   * @throws ValidationError si el monto no es válido
   */
  async create(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId || !req.user?.roleName) {
      throw new UnauthorizedError('Authentication required');
    }

    const { amount, appointmentId } = req.body;

    const payment = await this._createPayment.execute(
      {
        amount,
        appointmentId,
      },
      req.user.userId,
      req.user.roleName,
    );

    return res.status(201).json({
      success: true,
      data: payment,
      message: 'Payment created successfully',
    });
  }

  /**
   * Abre un checkout contra la pasarela de pago (ADMIN, STYLIST dueño,
   * CLIENT dueño de la cita)
   * @route POST /payments/checkout
   * @param req - Request autenticado con `appointmentId`/`amount`/
   * `description?` en el body y `Idempotency-Key` opcional en headers
   * @param res - Response de Express
   * @returns Promise con el checkout creado (o el ya existente, ante un
   * reintento con la misma `Idempotency-Key`)
   * @responseStatus 201 - Checkout creado
   * @responseStatus 200 - `Idempotency-Key` ya usada: se devuelve el checkout existente
   * @throws NotFoundError si la cita no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita
   * @throws BusinessRuleError si la cita no está en un estado válido para pagar,
   * o si la pasarela no está configurada
   * @throws ConflictError si ya hay un checkout pendiente para la cita (D5)
   */
  async createCheckout(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId || !req.user?.roleName) {
      throw new UnauthorizedError('Authentication required');
    }

    const { appointmentId, amount, description } = req.body;
    // express-validator normaliza el nombre de header a minúsculas
    const idempotencyKey = req.header('idempotency-key') || undefined;

    const { dto: checkout, created } = await this._createCheckout.execute(
      {
        appointmentId,
        amount,
        description,
        idempotencyKey,
      },
      req.user.userId,
      req.user.roleName,
    );

    return res.status(created ? 201 : 200).json({
      success: true,
      data: checkout,
      message: created
        ? 'Checkout created successfully'
        : 'Checkout already existed for this idempotency key',
    });
  }

  /**
   * Obtiene un pago por ID
   * @route GET /payments/:id
   * @param req - Request autenticado con ID del pago en params
   * @param res - Response de Express
   * @returns Promise con el pago encontrado
   * @responseStatus 200 - Pago obtenido exitosamente
   * @throws NotFoundError si el pago no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   */
  async getById(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId || !req.user?.roleName) {
      throw new UnauthorizedError('Authentication required');
    }

    const { id } = req.params;

    const payment = await this._getPaymentById.execute(id, req.user.userId, req.user.roleName);

    return res.status(200).json({
      success: true,
      data: payment,
      message: 'Payment retrieved successfully',
    });
  }

  /**
   * Obtiene los pagos de una cita
   * @route GET /payments/appointment/:appointmentId
   * @param req - Request autenticado con ID de la cita en params. Accesible
   * para ADMIN, STYLIST (dueño de la cita) y CLIENT (dueño de la cita, F18)
   * @param res - Response de Express
   * @returns Promise con la lista de pagos de la cita
   * @responseStatus 200 - Pagos obtenidos exitosamente
   * @throws NotFoundError si la cita no existe (para STYLIST/CLIENT)
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita
   */
  async getByAppointment(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId || !req.user?.roleName) {
      throw new UnauthorizedError('Authentication required');
    }

    const { appointmentId } = req.params;

    const payments = await this._getPaymentsByAppointment.execute(
      appointmentId,
      req.user.userId,
      req.user.roleName,
    );

    return res.status(200).json({
      success: true,
      data: payments,
      message: 'Appointment payments retrieved successfully',
    });
  }

  /**
   * Obtiene todos los pagos con filtros opcionales
   * @route GET /payments
   * @param req - Request con filtros en query params
   * @param res - Response de Express
   * @returns Promise con la lista paginada de pagos
   * @responseStatus 200 - Pagos obtenidos exitosamente
   */
  async getAll(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { page, limit, status, appointmentId, startDate, endDate } = req.query;

    const result = await this._getPayments.execute({
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      status: status as PaymentStatusEnum | undefined,
      appointmentId: appointmentId as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Payments retrieved successfully',
    });
  }

  /**
   * Procesa (completa) un pago
   * @route POST /payments/:id/process
   * @param req - Request autenticado con ID del pago y método de pago en el body
   * @param res - Response de Express
   * @returns Promise con el pago procesado
   * @responseStatus 200 - Pago procesado exitosamente
   * @throws NotFoundError si el pago no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   * @throws BusinessRuleError si el pago no puede ser procesado
   */
  async process(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId || !req.user?.roleName) {
      throw new UnauthorizedError('Authentication required');
    }

    const { id } = req.params;
    const { method } = req.body;

    const payment = await this._processPayment.execute(
      {
        paymentId: id,
        method: method as PaymentMethodEnum,
      },
      req.user.userId,
      req.user.roleName,
    );

    return res.status(200).json({
      success: true,
      data: payment,
      message: 'Payment processed successfully',
    });
  }

  /**
   * Reembolsa un pago completado
   * @route POST /payments/:id/refund
   * @param req - Request autenticado con ID del pago y razón del reembolso en el body
   * @param res - Response de Express
   * @returns Promise con el pago reembolsado
   * @responseStatus 200 - Pago reembolsado exitosamente
   * @throws NotFoundError si el pago no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   * @throws BusinessRuleError si el pago no puede ser reembolsado
   */
  async refund(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId || !req.user?.roleName) {
      throw new UnauthorizedError('Authentication required');
    }

    const { id } = req.params;
    const { reason } = req.body;

    const payment = await this._refundPayment.execute(
      {
        paymentId: id,
        reason,
      },
      req.user.userId,
      req.user.roleName,
    );

    return res.status(200).json({
      success: true,
      data: payment,
      message: 'Payment refunded successfully',
    });
  }

  /**
   * Cancela un pago pendiente
   * @route POST /payments/:id/cancel
   * @param req - Request autenticado con ID del pago en params
   * @param res - Response de Express
   * @returns Promise con el pago cancelado
   * @responseStatus 200 - Pago cancelado exitosamente
   * @throws NotFoundError si el pago no existe
   * @throws ForbiddenError si el usuario no tiene permisos sobre la cita del pago
   * @throws BusinessRuleError si el pago no puede ser cancelado
   */
  async cancel(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId || !req.user?.roleName) {
      throw new UnauthorizedError('Authentication required');
    }

    const { id } = req.params;

    const payment = await this._cancelPayment.execute(id, req.user.userId, req.user.roleName);

    return res.status(200).json({
      success: true,
      data: payment,
      message: 'Payment cancelled successfully',
    });
  }

  /**
   * Obtiene estadísticas de pagos en un período
   * @route GET /payments/statistics
   * @param req - Request con fechas de inicio y fin en query params
   * @param res - Response de Express
   * @returns Promise con las estadísticas de pagos
   * @responseStatus 200 - Estadísticas obtenidas exitosamente
   */
  async getStatistics(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { startDate, endDate } = req.query;

    const start = startDate
      ? new Date(startDate as string)
      : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate ? new Date(endDate as string) : new Date();

    const statistics = await this._getPaymentStatistics.execute(start, end);

    return res.status(200).json({
      success: true,
      data: statistics,
      message: 'Payment statistics retrieved successfully',
    });
  }

  /**
   * Actualiza un pago pendiente
   * @route PUT /payments/:id
   * @param req - Request con ID del pago y datos a actualizar en el body
   * @param res - Response de Express
   * @returns Promise con el pago actualizado
   * @responseStatus 200 - Pago actualizado exitosamente
   * @throws NotFoundError si el pago no existe
   * @throws BusinessRuleError si el pago no puede ser actualizado
   */
  async update(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { id } = req.params;
    const { amount } = req.body;

    const payment = await this._updatePayment.execute(id, { amount });

    return res.status(200).json({
      success: true,
      data: payment,
      message: 'Payment updated successfully',
    });
  }
}
