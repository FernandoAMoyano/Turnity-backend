import { body, param } from 'express-validator';

/**
 * Validaciones para el módulo de autenticación
 * @description Define las reglas de validación para los endpoints de auth usando express-validator
 */
export class AuthValidations {
  /**
   * Validación para el registro de un nuevo usuario
   */
  static register = [
    body('name')
      .notEmpty()
      .withMessage('Name is required')
      .isString()
      .withMessage('Name must be a string')
      .isLength({ min: 1, max: 100 })
      .withMessage('Name must be between 1 and 100 characters'),

    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Valid email is required')
      .normalizeEmail(),

    body('phone')
      .notEmpty()
      .withMessage('Phone is required')
      .matches(/^\+?[1-9]\d{6,14}$/)
      .withMessage('Valid phone is required'),

    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase, one lowercase, and one number'),

    body('roleName')
      .optional()
      .isString()
      .withMessage('Role name must be a string')
      .isIn(['CLIENT', 'STYLIST', 'ADMIN', 'client', 'stylist', 'admin'])
      .withMessage('Invalid role. Valid roles are: CLIENT, STYLIST, ADMIN'),

    body('profilePicture')
      .optional()
      .isURL()
      .withMessage('Profile picture must be a valid URL'),
  ];

  /**
   * Validación para verificar el email
   */
  static verifyEmail = [
    body('token')
      .notEmpty()
      .withMessage('Token is required')
      .isString()
      .withMessage('Token must be a string'),
  ];

  /**
   * Validación para reenviar el email de verificación
   */
  static resendVerification = [
    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Valid email is required')
      .normalizeEmail(),
  ];

  /**
   * Validación para el inicio de sesión
   */
  static login = [
    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Invalid email format'),

    body('password')
      .notEmpty()
      .withMessage('Password is required'),
  ];

  /**
   * Validación para renovar el token de acceso
   */
  static refreshToken = [
    body('refreshToken')
      .notEmpty()
      .withMessage('Refresh token is required')
      .isString()
      .withMessage('Refresh token must be a string'),
  ];

  /**
   * Validación para cerrar la sesión actual (logout).
   * En F5b el refresh pasará a leerse de cookie y esta validación de body se retira.
   */
  static logout = [
    body('refreshToken')
      .notEmpty()
      .withMessage('Refresh token is required')
      .isString()
      .withMessage('Refresh token must be a string'),
  ];

  /**
   * Validación para actualizar el perfil de usuario
   */
  static updateProfile = [
    body('name')
      .optional()
      .isString()
      .withMessage('Name must be a string')
      .isLength({ min: 1, max: 100 })
      .withMessage('Name must be between 1 and 100 characters'),

    body('phone')
      .optional()
      .matches(/^\+?[1-9]\d{6,14}$/)
      .withMessage('Valid phone is required'),

    body('profilePicture')
      .optional()
      .isURL()
      .withMessage('Profile picture must be a valid URL'),
  ];

  /**
   * Validación para cambiar la contraseña
   */
  static changePassword = [
    body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),

    body('newPassword')
      .notEmpty()
      .withMessage('New password is required')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('New password must contain at least one uppercase, one lowercase, and one number'),
  ];

  /**
   * Validación para desactivar un usuario (F11)
   */
  static deactivateUser = [
    param('id').isUUID().withMessage('User ID must be a valid UUID'),
  ];
}
