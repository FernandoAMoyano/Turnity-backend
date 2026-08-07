import { Request, Response, NextFunction } from 'express';
import { JwtService } from '../../application/services/JwtService';
import { UnauthorizedError } from '../../../../shared/exceptions/UnauthorizedError';
import { ForbiddenError } from '../../../../shared/exceptions/ForbiddenError';
import { IRoleRepository } from '../../domain/repositories/IRoleRepository';

/**
 * Interfaz extendida de Request que incluye información del usuario autenticado
 * Utilizada para tipar requests que han pasado por el middleware de autenticación
 */
export interface AuthenticatedRequest extends Request {
  /** Información del usuario autenticado extraída del token JWT */
  user?: {
    /** ID único del usuario en el sistema */
    userId: string;
    /** ID del rol asignado al usuario */
    roleId: string;
    /** Email del usuario para identificación */
    email: string;
    /** Nombre del rol del usuario, disponible después de pasar por authorize */
    roleName?: string;
  };
}

/**
 * Middleware de autenticación y autorización para proteger rutas
 * Valida tokens JWT y verifica permisos de usuario basados en roles
 */
export class AuthMiddleware {
  /**
   * Cache en memoria de roles (id -> name), poblada de forma perezosa.
   * Los roles son una tabla estática que no cambia en runtime, por lo que
   * evita una query a la base de datos en cada request autorizado (F15).
   */
  private readonly roleNameCache = new Map<string, string>();

  constructor(
    private jwtService: JwtService,
    private roleRepository: IRoleRepository,
  ) {}

  /**
   * Middleware de autenticación que valida tokens JWT en las peticiones
   * @param req - Request de Express extendido con información de usuario
   * @param res - Response de Express
   * @param next - NextFunction para continuar con el siguiente middleware
   * @returns void
   * @description Extrae y valida el token JWT del header Authorization
   * @throws UnauthorizedError si no hay token o el token es inválido
   */
  authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedError('Access token is required');
      }

      const token = authHeader.substring(7); // Remover 'Bearer '
      const payload = this.jwtService.verifyAccessToken(token);

      req.user = {
        userId: payload.userId,
        roleId: payload.roleId,
        email: payload.email,
      };

      next();
    } catch {
      next(new UnauthorizedError('Invalid or expired token'));
    }
  };

  /**
   * Middleware de autorización que verifica permisos basados en roles
   * @param allowedRoles - Array de roles que tienen permiso para acceder al recurso
   * @returns Función middleware que valida si el usuario tiene el rol requerido
   * @description Verifica que el usuario autenticado tenga uno de los roles permitidos
   * @throws UnauthorizedError si no hay usuario autenticado (req.user ausente -- no debería
   * ocurrir en la práctica, ya que authorize() siempre corre después de authenticate() en las rutas)
   * @throws ForbiddenError si el usuario está autenticado pero no tiene el rol requerido --
   * mismo criterio que ForbiddenError en appointments/notifications: usuario valido, solo sin
   * el permiso necesario, no es un problema de autenticacion (401)
   */
  authorize = (allowedRoles: string[]) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const roleName = await this.getRoleName(req.user.roleId);

        if (!roleName || !allowedRoles.includes(roleName)) {
          throw new ForbiddenError('Insufficient permissions');
        }

        // Adjuntar nombre del rol para que los controllers/use cases puedan usarlo
        req.user.roleName = roleName;

        next();
      } catch (error) {
        next(error);
      }
    };
  };

  /**
   * Resuelve el nombre del rol a partir de su ID, usando una cache en memoria
   * @param roleId - ID del rol a resolver
   * @returns Nombre del rol, o undefined si el rol no existe
   * @description Los roles son una tabla estática (ADMIN/CLIENT/STYLIST) que no
   * cambia en runtime, por lo que solo se consulta el repositorio una vez por
   * roleId; las siguientes resoluciones se sirven desde el Map en memoria (F15)
   */
  private async getRoleName(roleId: string): Promise<string | undefined> {
    const cached = this.roleNameCache.get(roleId);
    if (cached) {
      return cached;
    }

    const role = await this.roleRepository.findById(roleId);
    if (!role) {
      return undefined;
    }

    this.roleNameCache.set(roleId, role.name);
    return role.name;
  }
}
