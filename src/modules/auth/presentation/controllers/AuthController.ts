import { Request, Response } from 'express';

import { LoginUser } from '../../application/use-cases/LoginUser';
import { RegisterUser } from '../../application/use-cases/RegisterUser';
import { RefreshToken } from '../../application/use-cases/RefreshToken';
import { GetUserProfile } from '../../application/use-cases/GetUserProfile';
import { UpdateUserProfile } from '../../application/use-cases/UpdateUserProfile';
import { ChangeUserPassword } from '../../application/use-cases/ChangeUserPassword';
import { DeactivateUser } from '../../application/use-cases/DeactivateUser';
import { LogoutUser } from '../../application/use-cases/LogoutUser';
import { LogoutAllSessions } from '../../application/use-cases/LogoutAllSessions';
import { VerifyEmail } from '../../application/use-cases/VerifyEmail';
import { ResendVerification } from '../../application/use-cases/ResendVerification';
import { ForgotPassword } from '../../application/use-cases/ForgotPassword';
import { ResetPassword } from '../../application/use-cases/ResetPassword';
import { AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { generateCsrfToken } from '../middleware/CsrfMiddleware';
import {
  REFRESH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  refreshCookieOptions,
  refreshClearOptions,
  csrfCookieOptions,
  csrfClearOptions,
} from '../utils/cookieOptions';
import { RegisterDto } from '../../application/dto/request/RegisterDto';
import { LoginDto } from '../../application/dto/request/LoginDto';
import { UpdateProfileDto } from '../../application/dto/request/UpdateProfileDto';
import { ChangePasswordDto } from '../../application/dto/request/ChangePasswordDto';
import { VerifyEmailDto } from '../../application/dto/request/VerifyEmailDto';
import { ResendVerificationDto } from '../../application/dto/request/ResendVerificationDto';
import { ForgotPasswordDto } from '../../application/dto/request/ForgotPasswordDto';
import { ResetPasswordDto } from '../../application/dto/request/ResetPasswordDto';
import { UnauthorizedError } from '../../../../shared/exceptions/UnauthorizedError';
import { devTokenField } from '../../../../shared/utils/devToken';

/**
 * Controlador de autenticación que maneja peticiones HTTP
 * relacionadas con usuarios. Coordina las operaciones de
 * login, registro, renovación de tokens y gestión de perfiles.
 * Los métodos no capturan errores: los dejan propagar para que el errorHandler
 * global arme la respuesta uniforme.
 */
export class AuthController {
  constructor(
    private loginUser: LoginUser,
    private registerUser: RegisterUser,
    private refreshTokenUseCase: RefreshToken,
    private getUserProfile: GetUserProfile,
    private updateUserProfile: UpdateUserProfile,
    private changeUserPassword: ChangeUserPassword,
    private deactivateUserUseCase: DeactivateUser,
    private logoutUseCase: LogoutUser,
    private logoutAllUseCase: LogoutAllSessions,
    private verifyEmailUseCase: VerifyEmail,
    private resendVerificationUseCase: ResendVerification,
    private forgotPasswordUseCase: ForgotPassword,
    private resetPasswordUseCase: ResetPassword,
  ) {}

  /**
   * Autentica un usuario en el sistema
   * @route POST /auth/login
   * @param req - Request de Express con LoginDto en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Valida credenciales y retorna tokens de acceso y renovación
   * @responseStatus 200 - Login exitoso con tokens
   * @throws ValidationError si el formato del email o password es inválido
   * @throws UnauthorizedError si las credenciales son incorrectas o el usuario está inactivo
   */
  async login(req: Request, res: Response): Promise<Response> {
    const loginDto: LoginDto = req.body;
    const result = await this.loginUser.execute(loginDto, this.requestContext(req));

    // El refresh viaja en cookie httpOnly (no en el body). Se emite ademas la
    // cookie CSRF (legible por JS) para el patron double-submit.
    this.issueRefreshCookie(res, result.refreshToken);
    this.issueCsrfCookie(res);

    return res.status(200).json({
      success: true,
      data: { token: result.token, user: result.user },
      message: 'Login successful',
    });
  }

  /**
   * Registra un nuevo usuario en el sistema
   * @route POST /auth/register
   * @param req - Request de Express con RegisterDto en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Crea una nueva cuenta de usuario con rol asignado
   * @responseStatus 201 - Usuario registrado exitosamente
   * @throws ValidationError si los datos de entrada no son válidos
   * @throws ConflictError si el email ya está registrado
   * @throws NotFoundError si el rol especificado no existe
   */
  async register(req: Request, res: Response): Promise<Response> {
    const registerDto: RegisterDto = req.body;
    const result = await this.registerUser.execute(registerDto);

    return res.status(201).json({
      success: true,
      data: result.user,
      message: 'User registered successfully',
      // devToken solo en no-produccion con EXPOSE_VERIFICATION_TOKENS (pruebas por API)
      ...devTokenField(result.verificationToken),
    });
  }

  /**
   * Verifica el email de un usuario a partir del token del enlace
   * @route POST /auth/verify-email
   * @param req - Request con { token } en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @responseStatus 200 - Email verificado exitosamente
   * @throws InvalidTokenError si el token es invalido, de otro tipo, expirado o ya usado
   */
  async verifyEmail(req: Request, res: Response): Promise<Response> {
    const { token }: VerifyEmailDto = req.body;
    await this.verifyEmailUseCase.execute(token);

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully',
    });
  }

  /**
   * Reenvia el email de verificacion. Respuesta uniforme (anti-enumeracion):
   * identica exista o no el email y este verificado o no.
   * @route POST /auth/resend-verification
   * @param req - Request con { email } en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @responseStatus 200 - Respuesta generica
   */
  async resendVerification(req: Request, res: Response): Promise<Response> {
    const { email }: ResendVerificationDto = req.body;
    const result = await this.resendVerificationUseCase.execute(email);

    return res.status(200).json({
      success: true,
      message: 'If an account exists for that email, a verification link has been sent',
      ...devTokenField(result.verificationToken),
    });
  }

  /**
   * Solicita el reset de password. Respuesta uniforme (anti-enumeracion):
   * identica exista o no el email.
   * @route POST /auth/forgot-password
   * @param req - Request con { email } en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @responseStatus 200 - Respuesta generica
   */
  async forgotPassword(req: Request, res: Response): Promise<Response> {
    const { email }: ForgotPasswordDto = req.body;
    const result = await this.forgotPasswordUseCase.execute(email);

    return res.status(200).json({
      success: true,
      message: 'If an account exists for that email, a password reset link has been sent',
      ...devTokenField(result.resetToken),
    });
  }

  /**
   * Aplica el reset de password con el token del enlace. Revoca todas las sesiones.
   * @route POST /auth/reset-password
   * @param req - Request con { token, password } en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @responseStatus 200 - Password actualizada exitosamente
   * @throws InvalidTokenError si el token es invalido, expirado o ya usado
   * @throws ValidationError si la nueva password no cumple las reglas de fuerza
   */
  async resetPassword(req: Request, res: Response): Promise<Response> {
    const dto: ResetPasswordDto = req.body;
    await this.resetPasswordUseCase.execute(dto);

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  }

  /**
   * Renueva los tokens de acceso usando un refresh token
   * @route POST /auth/refresh-token
   * @param req - Request de Express con refreshToken en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Genera nuevos tokens cuando el token de acceso expira
   * @responseStatus 200 - Tokens renovados exitosamente
   * @throws ValidationError si no se proporciona refresh token
   * @throws UnauthorizedError si el refresh token es inválido o expirado
   */
  async refreshToken(req: Request, res: Response): Promise<Response> {
    const refreshToken: string = req.cookies?.[REFRESH_COOKIE_NAME] ?? '';
    const result = await this.refreshTokenUseCase.execute(refreshToken, this.requestContext(req));

    // Rotacion: se reemplaza la cookie de refresh por el token nuevo.
    // La cookie CSRF se mantiene (no hace falta rotarla en cada refresh).
    this.issueRefreshCookie(res, result.refreshToken);

    return res.status(200).json({
      success: true,
      data: { token: result.token, user: result.user },
      message: 'Token refreshed successfully',
    });
  }

  /**
   * Emite un token CSRF (patron double-submit)
   * @route GET /auth/csrf
   * @description Setea la cookie 'csrfToken' (legible por JS) y devuelve el token
   * en el body para que el cliente lo reenvie en el header X-CSRF-Token.
   * @responseStatus 200 - Token CSRF emitido
   */
  async csrf(req: Request, res: Response): Promise<Response> {
    const csrfToken = this.issueCsrfCookie(res);
    return res.status(200).json({
      success: true,
      data: { csrfToken },
      message: 'CSRF token issued',
    });
  }

  /**
   * Obtiene el perfil del usuario autenticado
   * @route GET /auth/profile
   * @param req - Request de Express autenticado con userId en req.user
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Retorna información completa del perfil del usuario
   * @responseStatus 200 - Perfil obtenido exitosamente
   * @throws UnauthorizedError si el request no está autenticado
   * @throws NotFoundError si el usuario no existe
   */
  async getProfile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const result = await this.getUserProfile.execute(req.user.userId);

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Profile retrieved successfully',
    });
  }

  /**
   * Actualiza el perfil del usuario autenticado
   * @route PUT /auth/profile
   * @param req - Request de Express con UpdateProfileDto en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Modifica datos del perfil como nombre, teléfono o foto de perfil
   * @responseStatus 200 - Perfil actualizado exitosamente
   * @throws UnauthorizedError si el request no está autenticado
   * @throws ValidationError si los datos de actualización no son válidos
   * @throws NotFoundError si el usuario no existe
   */
  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const updateDto: UpdateProfileDto = req.body;
    const result = await this.updateUserProfile.execute(req.user.userId, updateDto);

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Profile updated successfully',
    });
  }

  /**
   * Cambia la contraseña del usuario autenticado
   * @route PUT /auth/change-password
   * @param req - Request de Express con ChangePasswordDto en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Actualiza la contraseña verificando la contraseña actual antes del cambio
   * @responseStatus 200 - Contraseña cambiada exitosamente
   * @throws UnauthorizedError si el request no está autenticado o la contraseña actual es incorrecta
   * @throws ValidationError si la nueva contraseña no cumple los requisitos de seguridad
   * @throws NotFoundError si el usuario no existe
   */
  async changePassword(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const changePasswordDto: ChangePasswordDto = req.body;
    await this.changeUserPassword.execute(req.user.userId, changePasswordDto);

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  }

  /**
   * Desactiva un usuario del sistema
   * Si el usuario es STYLIST, ejecuta cascada: cancela citas activas y desactiva servicios
   * @route PATCH /auth/users/:id/deactivate
   * @param req - Request de Express autenticado con userId del admin
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Solo accesible por ADMIN. Desactiva usuario y ejecuta cascada si es STYLIST
   * @responseStatus 200 - Usuario desactivado exitosamente con resumen de cascada
   * @throws UnauthorizedError si el request no está autenticado
   * @throws NotFoundError si el usuario no existe
   * @throws BusinessRuleError si el usuario ya está inactivo
   */
  async deactivateUser(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const { id } = req.params;
    const result = await this.deactivateUserUseCase.execute(id);

    return res.status(200).json({
      success: true,
      data: result,
      message: 'User deactivated successfully',
    });
  }

  /**
   * Cierra la sesión actual revocando el refresh token recibido
   * @route POST /auth/logout
   * @param req - Request autenticado; refreshToken en el body
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Revoca la sesión del refresh token. Idempotente.
   * @responseStatus 200 - Sesión cerrada
   * @throws UnauthorizedError si el request no está autenticado
   */
  async logout(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const refreshToken: string = req.cookies?.[REFRESH_COOKIE_NAME] ?? '';
    await this.logoutUseCase.execute(req.user.userId, refreshToken);
    this.clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  }

  /**
   * Cierra todas las sesiones del usuario (logout de todos los dispositivos)
   * @route POST /auth/logout-all
   * @param req - Request autenticado
   * @param res - Response de Express
   * @returns Promise<Response>
   * @description Revoca todas las sesiones activas del usuario
   * @responseStatus 200 - Sesiones revocadas con su cantidad
   * @throws UnauthorizedError si el request no está autenticado
   */
  async logoutAll(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user?.userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const revokedCount = await this.logoutAllUseCase.execute(req.user.userId);
    this.clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      data: { revokedCount },
      message: 'All sessions revoked successfully',
    });
  }

  /**
   * Arma el contexto de la request para auditoria de la sesion (RFC 6819)
   * @private
   */
  private requestContext(req: Request) {
    return {
      requestId: req.id,
      userAgent: req.get('user-agent') ?? null,
      ipAddress: req.ip ?? null,
    };
  }

  /**
   * Setea la cookie httpOnly con el refresh token opaco
   * @private
   */
  private issueRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
  }

  /**
   * Genera y setea la cookie CSRF (legible por JS); devuelve el token
   * @private
   */
  private issueCsrfCookie(res: Response): string {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
    return token;
  }

  /**
   * Borra las cookies de refresh y CSRF (logout)
   * @private
   */
  private clearAuthCookies(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, refreshClearOptions());
    res.clearCookie(CSRF_COOKIE_NAME, csrfClearOptions());
  }
}
