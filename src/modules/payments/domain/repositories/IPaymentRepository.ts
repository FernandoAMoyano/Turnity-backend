import { Payment, PaymentProviderEnum, PaymentStatusEnum } from '../entities/Payment';

/**
 * Interface para filtros de búsqueda de pagos
 */
export interface PaymentFilters {
  status?: PaymentStatusEnum;
  appointmentId?: string;
  startDate?: Date;
  endDate?: Date;
  provider?: PaymentProviderEnum;
}

/**
 * Interface para opciones de paginación
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
}

/**
 * Interface para resultado paginado
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Interface del repositorio de pagos
 * @description Define las operaciones de persistencia para la entidad Payment
 */
export interface IPaymentRepository {
  /**
   * Guarda un nuevo pago
   * @param payment - Entidad de pago a guardar
   * @returns El pago guardado
   */
  save(payment: Payment): Promise<Payment>;

  /**
   * Busca un pago por su ID
   * @param id - ID del pago
   * @returns El pago encontrado o null
   */
  findById(id: string): Promise<Payment | null>;

  /**
   * Busca pagos por ID de cita
   * @param appointmentId - ID de la cita
   * @returns Lista de pagos asociados a la cita
   */
  findByAppointmentId(appointmentId: string): Promise<Payment[]>;

  /**
   * Busca todos los pagos con filtros opcionales
   * @param filters - Filtros de búsqueda
   * @param pagination - Opciones de paginación
   * @returns Resultado paginado de pagos
   */
  findAll(
    filters?: PaymentFilters,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<Payment>>;

  /**
   * Actualiza un pago existente
   * @param payment - Entidad de pago con cambios
   * @returns El pago actualizado
   */
  update(payment: Payment): Promise<Payment>;

  /**
   * Elimina un pago por su ID
   * @param id - ID del pago a eliminar
   * @returns true si se eliminó correctamente
   */
  delete(id: string): Promise<boolean>;

  /**
   * Obtiene estadísticas de pagos
   * @param startDate - Fecha de inicio del período
   * @param endDate - Fecha de fin del período
   * @returns Estadísticas de pagos
   */
  getStatistics(startDate: Date, endDate: Date): Promise<{
    totalRevenue: number;
    totalPayments: number;
    completedPayments: number;
    pendingPayments: number;
    refundedPayments: number;
    failedPayments: number;
    averagePayment: number;
    paymentsByMethod: Record<string, number>;
  }>;

  /**
   * Obtiene el total de ingresos por cita
   * @param appointmentId - ID de la cita
   * @returns Total de pagos completados para la cita
   */
  getTotalByAppointment(appointmentId: string): Promise<number>;
}
