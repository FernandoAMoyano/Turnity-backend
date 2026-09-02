import { body, header, param, query } from 'express-validator';

/**
 * Validaciones para el módulo de pagos
 */
export class PaymentValidations {
  /**
   * Validación para crear un pago
   */
  static createPayment = [
    body('amount')
      .notEmpty()
      .withMessage('Amount is required')
      .isFloat({ min: 0.01 })
      .withMessage('Amount must be greater than 0'),
    body('appointmentId')
      .notEmpty()
      .withMessage('Appointment ID is required')
      .isUUID()
      .withMessage('Appointment ID must be a valid UUID'),
  ];

  /**
   * Validación para crear un checkout contra la pasarela de pago
   * @description `Idempotency-Key` se valida como header opcional -- si se
   * envía, tiene que ser un UUID (mismo formato que el resto de los ids del
   * sistema); si no se envía, `CreateCheckout` genera uno.
   */
  static createCheckout = [
    body('appointmentId')
      .notEmpty()
      .withMessage('Appointment ID is required')
      .isUUID()
      .withMessage('Appointment ID must be a valid UUID'),
    body('amount')
      .notEmpty()
      .withMessage('Amount is required')
      .isFloat({ min: 0.01 })
      .withMessage('Amount must be greater than 0'),
    body('description')
      .optional()
      .isString()
      .withMessage('Description must be a string')
      .isLength({ max: 255 })
      .withMessage('Description cannot exceed 255 characters'),
    header('idempotency-key')
      .optional()
      .isUUID()
      .withMessage('Idempotency-Key header must be a valid UUID'),
  ];

  /**
   * Validación para procesar un pago
   */
  static processPayment = [
    param('id')
      .isUUID()
      .withMessage('Payment ID must be a valid UUID'),
    body('method')
      .notEmpty()
      .withMessage('Payment method is required')
      .isIn(['CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'ONLINE'])
      .withMessage('Payment method must be valid (CASH, CREDIT_CARD, DEBIT_CARD, TRANSFER, ONLINE)'),
  ];

  /**
   * Validación para reembolsar un pago
   */
  static refundPayment = [
    param('id')
      .isUUID()
      .withMessage('Payment ID must be a valid UUID'),
    body('reason')
      .optional()
      .isString()
      .withMessage('Reason must be a string')
      .isLength({ max: 500 })
      .withMessage('Reason cannot exceed 500 characters'),
  ];

  /**
   * Validación para obtener pago por ID
   */
  static paymentById = [
    param('id')
      .isUUID()
      .withMessage('Payment ID must be a valid UUID'),
  ];

  /**
   * Validación para obtener pagos por cita
   */
  static paymentsByAppointment = [
    param('appointmentId')
      .isUUID()
      .withMessage('Appointment ID must be a valid UUID'),
  ];

  /**
   * Validación para listar pagos
   */
  static getPayments = [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('status')
      .optional()
      .isIn(['PENDING', 'COMPLETED', 'REFUNDED', 'FAILED'])
      .withMessage('Status must be valid (PENDING, COMPLETED, REFUNDED, FAILED)'),
    query('appointmentId')
      .optional()
      .isUUID()
      .withMessage('Appointment ID must be a valid UUID'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid ISO 8601 date'),
  ];

  /**
   * Validación para estadísticas
   */
  static getStatistics = [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid ISO 8601 date'),
  ];

  /**
   * Validación para actualizar un pago
   */
  static updatePayment = [
    param('id')
      .isUUID()
      .withMessage('Payment ID must be a valid UUID'),
    body('amount')
      .optional()
      .isFloat({ min: 0.01 })
      .withMessage('Amount must be greater than 0'),
  ];
}
