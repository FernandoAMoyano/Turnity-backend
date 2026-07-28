import { Prisma } from '@prisma/client';
import { User } from '../entities/User';

/**
 * Usuario junto con su Role incluido (resultado de `include: { role: true }`).
 * Se usa el tipo generado por Prisma en vez de `any` -- se mantiene sincronizado
 * automaticamente con el schema, sin duplicar la forma del objeto a mano.
 */
export type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

/**
 * Interfaz del repositorio para operaciones de persistencia de usuarios
 * Define el contrato para acceso a datos de usuarios sin exponer detalles de implementación
 */
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByIdWithRole(id: string): Promise<UserWithRole | null>;
  findByEmail(email: string): Promise<User | null>;
  findByEmailWithRole(email: string): Promise<UserWithRole | null>;
  existsByEmail(email: string): Promise<boolean>;
  /**
   * Marca el email del usuario como verificado (idempotente).
   * Setea emailVerified=true y emailVerifiedAt=now.
   */
  markEmailAsVerified(userId: string): Promise<void>;
  save(user: User): Promise<User>;
  update(user: User): Promise<User>;
  delete(id: string): Promise<void>;
  findAll(): Promise<User[]>;
  findByRole(roleId: string): Promise<User[]>;
}
