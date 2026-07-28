import { PrismaClient } from '@prisma/client';
import { User } from '../../domain/entities/User';
import { IUserRepository, UserWithRole } from '../../domain/repositories/IUserRepository';

/**
 * Implementación de UserRepository usando Prisma ORM
 * Proporciona persistencia de datos de usuarios en base de datos relacional
 */
export class PrismaUserRepository implements IUserRepository {
  /**
   * Constructor que inyecta el cliente Prisma
   * @param prisma - Cliente Prisma para acceso a base de datos
   */
  constructor(private prisma: PrismaClient) {}

  /**
   * Busca un usuario por su ID único en la base de datos
   * @param id - ID único del usuario
   * @returns Promise que resuelve con el usuario encontrado o null si no existe
   * @description Mapea datos de Prisma a entidad de dominio User
   */
  async findById(id: string): Promise<User | null> {
    const userData = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!userData) return null;

    return new User(
      userData.id,
      userData.roleId,
      userData.name,
      userData.email,
      userData.phone,
      userData.password,
      userData.isActive,
      userData.profilePicture,
      userData.preferences,
      userData.createdAt,
      userData.updatedAt,
    );
  }

  /**
   * Busca un usuario por su email en la base de datos
   * @param email - Email del usuario (se normaliza a minúsculas)
   * @returns Promise que resuelve con el usuario encontrado o null si no existe
   * @description Normaliza email a minúsculas antes de la búsqueda
   */
  async findByEmail(email: string): Promise<User | null> {
    const userData = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!userData) return null;

    return new User(
      userData.id,
      userData.roleId,
      userData.name,
      userData.email,
      userData.phone,
      userData.password,
      userData.isActive,
      userData.profilePicture,
      userData.preferences,
      userData.createdAt,
      userData.updatedAt,
    );
  }

  /**
   * Busca usuario por email incluyendo datos del rol asociado
   * @param email - Email del usuario
   * @returns Promise con usuario y rol o null si no existe
   * @description Usa include de Prisma para obtener relación con tabla role
   */
  async findByEmailWithRole(email: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        role: true,
      },
    });
  }

  /**
   * Busca usuario por ID incluyendo datos del rol asociado
   * @param id - ID del usuario
   * @returns Promise con usuario y rol o null si no existe
   * @description Usa include de Prisma para obtener relación con tabla role.
   * Devuelve el resultado de Prisma directamente (mismo patron que
   * findByEmailWithRole).
   */
  async findByIdWithRole(id: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        role: true,
      },
    });
  }

  /**
   * Verifica si existe un usuario con el email especificado
   * @param email - Email a verificar
   * @returns Promise<boolean> true si existe, false si no
   * @description Usa count de Prisma para verificación eficiente
   */
  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { email: email.toLowerCase() },
    });
    return count > 0;
  }

  /**
   * Marca el email de un usuario como verificado (idempotente)
   * @param userId - ID del usuario
   * @description Setea emailVerified=true y emailVerifiedAt=now
   */
  async markEmailAsVerified(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
  }

  /**
   * Guarda un nuevo usuario en la base de datos
   * @param user - Entidad User a persistir
   * @returns Promise con el usuario guardado
   * @description Mapea entidad de dominio a modelo Prisma y viceversa
   */
  async save(user: User): Promise<User> {
    const userData = await this.prisma.user.create({
      data: {
        id: user.id,
        roleId: user.roleId,
        name: user.name,
        email: user.email.toLowerCase(),
        phone: user.phone,
        password: user.password,
        isActive: user.isActive,
        profilePicture: user.profilePicture,
        preferences: user.preferences,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });

    return new User(
      userData.id,
      userData.roleId,
      userData.name,
      userData.email,
      userData.phone,
      userData.password,
      userData.isActive,
      userData.profilePicture,
      userData.preferences,
      userData.createdAt,
      userData.updatedAt,
    );
  }

  /**
   * Actualiza un usuario existente en la base de datos
   * @param user - Entidad User con datos actualizados
   * @returns Promise con el usuario actualizado
   * @description Solo actualiza campos modificables (excluye email, roleId, etc.)
   */
  async update(user: User): Promise<User> {
    const userData = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: user.name,
        phone: user.phone,
        password: user.password,
        isActive: user.isActive,
        profilePicture: user.profilePicture,
        preferences: user.preferences,
        updatedAt: user.updatedAt,
      },
    });

    return new User(
      userData.id,
      userData.roleId,
      userData.name,
      userData.email,
      userData.phone,
      userData.password,
      userData.isActive,
      userData.profilePicture,
      userData.preferences,
      userData.createdAt,
      userData.updatedAt,
    );
  }

  /**
   * Elimina un usuario de la base de datos
   * @param id - ID del usuario a eliminar
   * @returns Promise que se resuelve cuando la eliminación es exitosa
   */
  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id },
    });
  }

  /**
   * Obtiene todos los usuarios de la base de datos
   * @returns Promise con lista de usuarios ordenados por fecha de creación
   * @description Ordena por createdAt descendente (más recientes primero)
   */
  async findAll(): Promise<User[]> {
    const usersData = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return usersData.map(
      (userData) =>
        new User(
          userData.id,
          userData.roleId,
          userData.name,
          userData.email,
          userData.phone,
          userData.password,
          userData.isActive,
          userData.profilePicture,
          userData.preferences,
          userData.createdAt,
          userData.updatedAt,
        ),
    );
  }

  /**
   * Busca usuarios filtrados por rol
   * @param roleId - ID del rol a filtrar
   * @returns Promise con lista de usuarios del rol especificado
   * @description Filtra por roleId y ordena por fecha de creación
   */
  async findByRole(roleId: string): Promise<User[]> {
    const usersData = await this.prisma.user.findMany({
      where: { roleId },
      orderBy: { createdAt: 'desc' },
    });

    return usersData.map(
      (userData) =>
        new User(
          userData.id,
          userData.roleId,
          userData.name,
          userData.email,
          userData.phone,
          userData.password,
          userData.isActive,
          userData.profilePicture,
          userData.preferences,
          userData.createdAt,
          userData.updatedAt,
        ),
    );
  }
}
