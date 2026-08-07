import { PrismaClient } from '@prisma/client';
import { AuthController } from './presentation/controllers/AuthController';
import { AuthMiddleware } from './presentation/middleware/AuthMiddleware';
import { AuthRoutes } from './presentation/routes/AuthRoutes';
import { LoginUser } from './application/use-cases/LoginUser';
import { RegisterUser } from './application/use-cases/RegisterUser';
import { RefreshToken } from './application/use-cases/RefreshToken';
import { GetUserProfile } from './application/use-cases/GetUserProfile';
import { UpdateUserProfile } from './application/use-cases/UpdateUserProfile';
import { ChangeUserPassword } from './application/use-cases/ChangeUserPassword';
import { DeactivateUser } from './application/use-cases/DeactivateUser';
import { LogoutUser } from './application/use-cases/LogoutUser';
import { LogoutAllSessions } from './application/use-cases/LogoutAllSessions';
import { PrismaUserRepository } from './infrastructure/persistence/PrismaUserRepository';
import { PrismaRoleRepository } from './infrastructure/persistence/PrismaRolRepository';
import { PrismaStylistServiceRepository } from '../services/infrastructure/persistence/PrismaStylistServiceRepository';
import { PrismaAppointmentRepository } from '../appointments/infrastructure/persistence/PrismaAppointmentRepository';
import { PrismaAppointmentStatusRepository } from '../appointments/infrastructure/persistence/PrismaAppointmentStatusRepository';
import { IUserRepository } from './domain/repositories/IUserRepository';
import { IRoleRepository } from './domain/repositories/IRoleRepository';
import { IStylistServiceRepository } from '../services/domain/repositories/IStylistServiceRepository';
import { IAppointmentRepository } from '../appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../appointments/domain/repositories/IAppointmentStatusRepository';
import { BcryptHashService } from './infrastructure/services/BcryptHashService';
import { JwtTokenService } from './infrastructure/services/JwtTokenService';
import { JwtService } from './application/services/JwtService';
import { HashService } from './application/services/HashService';
import { PrismaRefreshTokenRepository } from './infrastructure/persistence/PrismaRefreshTokenRepository';
import { CryptoRefreshTokenService } from './infrastructure/services/CryptoRefreshTokenService';
import { IRefreshTokenRepository } from './domain/repositories/IRefreshTokenRepository';
import { RefreshTokenService } from './application/services/RefreshTokenService';
import { PrismaVerificationTokenRepository } from './infrastructure/persistence/PrismaVerificationTokenRepository';
import { CryptoVerificationTokenService } from './infrastructure/services/CryptoVerificationTokenService';
import { IVerificationTokenRepository } from './domain/repositories/IVerificationTokenRepository';
import { VerificationTokenService } from './application/services/VerificationTokenService';
import { NodemailerEmailService } from '../../shared/email/NodemailerEmailService';
import { EmailService } from '../../shared/email/EmailService';
import { VerifyEmail } from './application/use-cases/VerifyEmail';
import { ResendVerification } from './application/use-cases/ResendVerification';
import { ForgotPassword } from './application/use-cases/ForgotPassword';
import { ResetPassword } from './application/use-cases/ResetPassword';

/**
 * Contenedor de dependencias para el módulo de autenticación
 * Implementa el patrón Singleton y configura todas las dependencias del módulo auth
 * usando inyección de dependencias manual
 */
export class AuthContainer {
  /** Instancia singleton del contenedor */
  private static instance: AuthContainer;
  private _authController: AuthController;
  private _authMiddleware: AuthMiddleware;
  private _authRoutes: AuthRoutes;

  private _loginUser: LoginUser;
  private _registerUser: RegisterUser;
  private _refreshToken: RefreshToken;
  private _getUserProfile: GetUserProfile;
  private _updateUserProfile: UpdateUserProfile;
  private _changeUserPassword: ChangeUserPassword;
  private _deactivateUser: DeactivateUser;
  private _logoutUser: LogoutUser;
  private _logoutAll: LogoutAllSessions;

  /**
   * Constructor privado que inicializa todas las dependencias del módulo
   * @param prisma - Cliente Prisma para acceso a base de datos
   * @description Configura la cadena completa de dependencias siguiendo arquitectura hexagonal
   */
  private constructor(private prisma: PrismaClient) {
    this.setupDependencies();
  }

  /**
   * Obtiene la instancia singleton del contenedor
   * @param prisma - Cliente Prisma para inicialización
   * @returns Instancia única del AuthContainer
   * @description Implementa patrón Singleton para asegurar una sola instancia
   */
  static getInstance(prisma: PrismaClient): AuthContainer {
    if (!AuthContainer.instance) {
      AuthContainer.instance = new AuthContainer(prisma);
    }
    return AuthContainer.instance;
  }

  /**
   * Configura todas las dependencias del módulo de autenticación
   * @private
   * @description Inyecta dependencias siguiendo el orden: repositories -> services -> use cases -> controllers
   */
  private setupDependencies(): void {
    // Repositories - Auth
    const userRepository: IUserRepository = new PrismaUserRepository(this.prisma);
    const roleRepository: IRoleRepository = new PrismaRoleRepository(this.prisma);

    // Repositories - Cross-module (para cascada en desactivación)
    const stylistServiceRepository: IStylistServiceRepository = new PrismaStylistServiceRepository(this.prisma);
    const appointmentRepository: IAppointmentRepository = new PrismaAppointmentRepository(this.prisma);
    const appointmentStatusRepository: IAppointmentStatusRepository = new PrismaAppointmentStatusRepository(this.prisma);

    // Services
    const hashService: HashService = new BcryptHashService();
    const jwtService: JwtService = new JwtTokenService();
    const refreshTokenRepository: IRefreshTokenRepository = new PrismaRefreshTokenRepository(
      this.prisma,
    );
    const refreshTokenService: RefreshTokenService = new CryptoRefreshTokenService();

    // Verificacion de email / reset de password
    const verificationTokenRepository: IVerificationTokenRepository =
      new PrismaVerificationTokenRepository(this.prisma);
    const verificationTokenService: VerificationTokenService =
      new CryptoVerificationTokenService(verificationTokenRepository);
    const emailService: EmailService = new NodemailerEmailService();

    // Use Cases
    this._loginUser = new LoginUser(
      userRepository,
      hashService,
      jwtService,
      refreshTokenRepository,
      refreshTokenService,
    );
    this._registerUser = new RegisterUser(
      userRepository,
      roleRepository,
      hashService,
      verificationTokenService,
      emailService,
    );
    this._refreshToken = new RefreshToken(
      userRepository,
      roleRepository,
      jwtService,
      refreshTokenRepository,
      refreshTokenService,
    );
    this._getUserProfile = new GetUserProfile(userRepository, roleRepository);
    this._updateUserProfile = new UpdateUserProfile(userRepository, roleRepository);
    this._changeUserPassword = new ChangeUserPassword(userRepository, hashService);
    this._deactivateUser = new DeactivateUser(
      userRepository,
      roleRepository,
      stylistServiceRepository,
      appointmentRepository,
      appointmentStatusRepository,
    );
    this._logoutUser = new LogoutUser(refreshTokenRepository, refreshTokenService);
    this._logoutAll = new LogoutAllSessions(refreshTokenRepository);

    const verifyEmail = new VerifyEmail(userRepository, verificationTokenService);
    const resendVerification = new ResendVerification(
      userRepository,
      verificationTokenService,
      emailService,
    );

    const forgotPassword = new ForgotPassword(
      userRepository,
      verificationTokenService,
      emailService,
    );
    const resetPassword = new ResetPassword(
      userRepository,
      verificationTokenService,
      hashService,
      refreshTokenRepository,
    );

    // HTTP Layer - Inyectamos los casos de uso directamente
    this._authController = new AuthController(
      this._loginUser,
      this._registerUser,
      this._refreshToken,
      this._getUserProfile,
      this._updateUserProfile,
      this._changeUserPassword,
      this._deactivateUser,
      this._logoutUser,
      this._logoutAll,
      verifyEmail,
      resendVerification,
      forgotPassword,
      resetPassword,
    );

    this._authMiddleware = new AuthMiddleware(jwtService, roleRepository);
    this._authRoutes = new AuthRoutes(this._authController, this._authMiddleware);
  }

  // Getters para acceso externo
  /**
   * Obtiene el controlador de autenticación configurado
   * @returns Instancia de AuthController con todas sus dependencias inyectadas
   */
  get authController(): AuthController {
    return this._authController;
  }

  /**
   * Obtiene el middleware de autenticación configurado
   * @returns Instancia de AuthMiddleware con JwtService e IRoleRepository inyectados
   */
  get authMiddleware(): AuthMiddleware {
    return this._authMiddleware;
  }

  /**
   * Obtiene las rutas de autenticación configuradas
   * @returns Instancia de AuthRoutes con controller y middleware inyectados
   */
  get authRoutes(): AuthRoutes {
    return this._authRoutes;
  }

  // Getters para casos de uso (opcional, para testing o uso directo)
  /**
   * Obtiene el caso de uso de login configurado
   * @returns Instancia de LoginUser para uso directo o testing
   */
  get loginUser(): LoginUser {
    return this._loginUser;
  }

  /**
   * Obtiene el caso de uso de registro configurado
   * @returns Instancia de RegisterUser para uso directo o testing
   */
  get registerUser(): RegisterUser {
    return this._registerUser;
  }

  /**
   * Obtiene el caso de uso de renovación de tokens configurado
   * @returns Instancia de RefreshToken para uso directo o testing
   */
  get refreshToken(): RefreshToken {
    return this._refreshToken;
  }

  /**
   * Obtiene el caso de uso de consulta de perfil configurado
   * @returns Instancia de GetUserProfile para uso directo o testing
   */
  get getUserProfile(): GetUserProfile {
    return this._getUserProfile;
  }

  /**
   * Obtiene el caso de uso de actualización de perfil configurado
   * @returns Instancia de UpdateUserProfile para uso directo o testing
   */
  get updateUserProfile(): UpdateUserProfile {
    return this._updateUserProfile;
  }

  /**
   * Obtiene el caso de uso de cambio de contraseña configurado
   * @returns Instancia de ChangeUserPassword para uso directo o testing
   */
  get changeUserPassword(): ChangeUserPassword {
    return this._changeUserPassword;
  }
}
