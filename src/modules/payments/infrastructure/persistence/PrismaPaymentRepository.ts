import {
  Prisma,
  PrismaClient,
  PaymentStatus,
  PaymentMethod,
  PaymentProvider,
} from '@prisma/client';
import {
  Payment,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../domain/entities/Payment';
import {
  IPaymentRepository,
  PaymentFilters,
  PaginationOptions,
  PaginatedResult,
} from '../../domain/repositories/IPaymentRepository';
import { IPaymentGatewayLookup } from '../../domain/repositories/IPaymentGatewayLookup';
import { ConflictError } from '../../../../shared/exceptions/ConflictError';

/**
 * Código de error de Prisma para violación de restricción única
 */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Índice único parcial que admite un solo pago de pasarela PENDING por cita.
 * No figura en el schema de Prisma: se crea en su propia migración.
 */
const OPEN_GATEWAY_CHECKOUT_INDEX = 'Payment_appointmentId_open_gateway_checkout_key';

/**
 * Implementación del repositorio de pagos con Prisma
 */
export class PrismaPaymentRepository implements IPaymentRepository, IPaymentGatewayLookup {
  constructor(private prisma: PrismaClient) {}

  /**
   * Guarda un nuevo pago
   * @description Si dos pedidos abren un checkout sobre la misma cita al mismo
   * tiempo, los dos pasan la verificación de cobro único antes de que alguno
   * guarde su pago. El índice único parcial de la base resuelve esa carrera:
   * el segundo `create` falla y se traduce a un conflicto.
   * @throws ConflictError si la cita ya tiene un checkout de pasarela abierto
   */
  async save(payment: Payment): Promise<Payment> {
    try {
      return await this.create(payment);
    } catch (error) {
      if (this.isOpenGatewayCheckoutViolation(error)) {
        throw new ConflictError(
          'There is already a pending checkout for this appointment. Wait for it to expire or resolve, or ask an admin to sync it.',
        );
      }
      throw error;
    }
  }

  /**
   * Inserta el pago y lo devuelve como entidad de dominio
   */
  private async create(payment: Payment): Promise<Payment> {
    const data = await this.prisma.payment.create({
      data: {
        id: payment.id,
        amount: payment.amount,
        status: payment.status as PaymentStatus,
        method: payment.method as PaymentMethod | null,
        paymentDate: payment.paymentDate,
        appointmentId: payment.appointmentId,
        provider: payment.provider as PaymentProvider,
        gatewayPaymentId: payment.gatewayPaymentId,
        gatewayPreferenceId: payment.gatewayPreferenceId,
        gatewayStatus: payment.gatewayStatus,
        idempotencyKey: payment.idempotencyKey,
        checkoutUrl: payment.checkoutUrl,
        checkoutExpiresAt: payment.checkoutExpiresAt,
        refundedAmount: payment.refundedAmount,
        gatewayRefundId: payment.gatewayRefundId,
        failureReason: payment.failureReason,
        lastSyncedAt: payment.lastSyncedAt,
      },
    });

    return this.toDomain(data);
  }

  /**
   * Indica si el error es una violación del índice de un checkout abierto por cita
   * @description Prisma informa en `meta.target` el nombre del índice o la
   * lista de columnas, según conozca o no el índice desde el schema. Las dos
   * formas identifican este índice sin ambigüedad: es la única restricción
   * única sobre `appointmentId`.
   */
  private isOpenGatewayCheckoutViolation(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== UNIQUE_CONSTRAINT_VIOLATION
    ) {
      return false;
    }

    const target = error.meta?.target;
    if (typeof target === 'string') {
      return target === OPEN_GATEWAY_CHECKOUT_INDEX;
    }
    return Array.isArray(target) && target.length === 1 && target[0] === 'appointmentId';
  }

  /**
   * Busca un pago por ID
   */
  async findById(id: string): Promise<Payment | null> {
    const data = await this.prisma.payment.findUnique({
      where: { id },
    });

    return data ? this.toDomain(data) : null;
  }

  /**
   * Busca pagos por ID de cita
   */
  async findByAppointmentId(appointmentId: string): Promise<Payment[]> {
    const data = await this.prisma.payment.findMany({
      where: { appointmentId },
      orderBy: { createdAt: 'desc' },
    });

    return data.map((item) => this.toDomain(item));
  }

  /**
   * Busca un pago por su identificador en la pasarela
   */
  async findByGatewayPaymentId(gatewayPaymentId: string): Promise<Payment | null> {
    const data = await this.prisma.payment.findUnique({
      where: { gatewayPaymentId },
    });

    return data ? this.toDomain(data) : null;
  }

  /**
   * Busca un pago por su clave de idempotencia
   */
  async findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    const data = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });

    return data ? this.toDomain(data) : null;
  }

  /**
   * Busca todos los pagos con filtros
   */
  async findAll(
    filters?: PaymentFilters,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<Payment>> {
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {};

    if (filters?.status) {
      where.status = filters.status as PaymentStatus;
    }

    if (filters?.appointmentId) {
      where.appointmentId = filters.appointmentId;
    }

    if (filters?.provider) {
      where.provider = filters.provider as PaymentProvider;
    }

    if (filters?.startDate || filters?.endDate) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (filters?.startDate) {
        createdAtFilter.gte = filters.startDate;
      }
      if (filters?.endDate) {
        createdAtFilter.lte = filters.endDate;
      }
      where.createdAt = createdAtFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item) => this.toDomain(item)),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Actualiza un pago
   * @description Los campos de pasarela se escriben con `?? null` y no con
   * undefined: en Prisma, undefined significa "no tocar esta columna", así que
   * un campo que la entidad limpió (por ejemplo failureReason al pasar a
   * COMPLETED) conservaría el valor viejo en la base. `provider` e
   * `idempotencyKey` quedan fuera a propósito: son inmutables una vez creado el
   * pago.
   */
  async update(payment: Payment): Promise<Payment> {
    const data = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        amount: payment.amount,
        status: payment.status as PaymentStatus,
        method: payment.method as PaymentMethod | null,
        paymentDate: payment.paymentDate,
        refundReason: payment.refundReason,
        gatewayPaymentId: payment.gatewayPaymentId ?? null,
        gatewayPreferenceId: payment.gatewayPreferenceId ?? null,
        gatewayStatus: payment.gatewayStatus ?? null,
        checkoutUrl: payment.checkoutUrl ?? null,
        checkoutExpiresAt: payment.checkoutExpiresAt ?? null,
        refundedAmount: payment.refundedAmount ?? null,
        gatewayRefundId: payment.gatewayRefundId ?? null,
        failureReason: payment.failureReason ?? null,
        lastSyncedAt: payment.lastSyncedAt ?? null,
      },
    });

    return this.toDomain(data);
  }

  /**
   * Elimina un pago
   */
  async delete(id: string): Promise<boolean> {
    await this.prisma.payment.delete({
      where: { id },
    });
    return true;
  }

  /**
   * Obtiene estadísticas de pagos
   */
  async getStatistics(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalRevenue: number;
    totalPayments: number;
    completedPayments: number;
    pendingPayments: number;
    refundedPayments: number;
    failedPayments: number;
    averagePayment: number;
    paymentsByMethod: Record<string, number>;
  }> {
    const where = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Obtener conteos por estado
    const [totalPayments, completedPayments, pendingPayments, refundedPayments, failedPayments] =
      await Promise.all([
        this.prisma.payment.count({ where }),
        this.prisma.payment.count({ where: { ...where, status: 'COMPLETED' } }),
        this.prisma.payment.count({ where: { ...where, status: 'PENDING' } }),
        this.prisma.payment.count({ where: { ...where, status: 'REFUNDED' } }),
        this.prisma.payment.count({ where: { ...where, status: 'FAILED' } }),
      ]);

    // Calcular ingresos totales (solo pagos completados)
    const revenueResult = await this.prisma.payment.aggregate({
      where: { ...where, status: 'COMPLETED' },
      _sum: { amount: true },
    });
    const totalRevenue = Number(revenueResult._sum.amount) || 0;

    // Calcular promedio
    const averagePayment = completedPayments > 0 ? totalRevenue / completedPayments : 0;

    // Pagos por método
    const paymentsByMethodResult = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { ...where, status: 'COMPLETED', method: { not: null } },
      _count: true,
    });

    const paymentsByMethod: Record<string, number> = {};
    paymentsByMethodResult.forEach((item) => {
      if (item.method) {
        paymentsByMethod[item.method] = item._count;
      }
    });

    return {
      totalRevenue,
      totalPayments,
      completedPayments,
      pendingPayments,
      refundedPayments,
      failedPayments,
      averagePayment,
      paymentsByMethod,
    };
  }

  /**
   * Obtiene el total de pagos completados por cita
   */
  async getTotalByAppointment(appointmentId: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: {
        appointmentId,
        status: 'COMPLETED',
      },
      _sum: { amount: true },
    });

    return Number(result._sum.amount) || 0;
  }

  /**
   * Convierte datos de Prisma a entidad de dominio
   */
  private toDomain(data: Prisma.PaymentGetPayload<object>): Payment {
    return new Payment({
      id: data.id,
      amount: Number(data.amount),
      status: data.status as PaymentStatusEnum,
      method: data.method as PaymentMethodEnum | null,
      paymentDate: data.paymentDate,
      appointmentId: data.appointmentId,
      refundReason: data.refundReason ?? undefined,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      provider: data.provider as PaymentProviderEnum,
      gatewayPaymentId: data.gatewayPaymentId ?? undefined,
      gatewayPreferenceId: data.gatewayPreferenceId ?? undefined,
      gatewayStatus: data.gatewayStatus ?? undefined,
      idempotencyKey: data.idempotencyKey ?? undefined,
      checkoutUrl: data.checkoutUrl ?? undefined,
      checkoutExpiresAt: data.checkoutExpiresAt ?? undefined,
      // Comparación explícita contra null: un reembolso de 0 es un valor
      // legítimo y `?? undefined` sobre un Decimal 0 lo conservaría, pero
      // Number(null) daría 0 y falsearía el dato.
      refundedAmount: data.refundedAmount !== null ? Number(data.refundedAmount) : undefined,
      gatewayRefundId: data.gatewayRefundId ?? undefined,
      failureReason: data.failureReason ?? undefined,
      lastSyncedAt: data.lastSyncedAt ?? undefined,
    });
  }
}
