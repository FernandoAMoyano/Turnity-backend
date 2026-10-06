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

/**
 * Implementación del repositorio de pagos con Prisma
 */
export class PrismaPaymentRepository implements IPaymentRepository, IPaymentGatewayLookup {
  constructor(private prisma: PrismaClient) {}

  /**
   * Guarda un nuevo pago
   */
  async save(payment: Payment): Promise<Payment> {
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
        refundedAmount: payment.refundedAmount,
        gatewayRefundId: payment.gatewayRefundId,
        failureReason: payment.failureReason,
        lastSyncedAt: payment.lastSyncedAt,
      },
    });

    return this.toDomain(data);
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
