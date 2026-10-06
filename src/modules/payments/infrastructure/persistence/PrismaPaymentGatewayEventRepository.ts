import { Prisma, PrismaClient, PaymentProvider, GatewayEventStatus } from '@prisma/client';
import { PaymentProviderEnum } from '../../domain/entities/Payment';
import {
  PaymentGatewayEvent,
  GatewayEventStatusEnum,
} from '../../domain/entities/PaymentGatewayEvent';
import { IPaymentGatewayEventRepository } from '../../domain/repositories/IPaymentGatewayEventRepository';

/**
 * Código de error de Prisma para violación de restricción única
 */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Implementación del repositorio de eventos de pasarela con Prisma
 */
export class PrismaPaymentGatewayEventRepository implements IPaymentGatewayEventRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Guarda el evento solo si no fue recibido antes
   * @description Intenta insertar y deja que la restricción única de
   * (provider, eventId) resuelva la carrera. Consultar antes de insertar
   * dejaría una ventana entre ambas operaciones en la que dos notificaciones
   * simultáneas del mismo evento pasarían las dos.
   */
  async saveIfNotExists(event: PaymentGatewayEvent): Promise<PaymentGatewayEvent | null> {
    try {
      const data = await this.prisma.paymentGatewayEvent.create({
        data: {
          id: event.id,
          provider: event.provider as PaymentProvider,
          eventId: event.eventId,
          eventType: event.eventType,
          paymentId: event.paymentId,
          status: event.status as GatewayEventStatus,
          signatureValid: event.signatureValid,
          rawPayload: event.rawPayload as Prisma.InputJsonValue,
          error: event.error,
          receivedAt: event.receivedAt,
          processedAt: event.processedAt,
        },
      });

      return this.toDomain(data);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Marca un evento como procesado con éxito
   */
  async markProcessed(id: string, paymentId?: string): Promise<PaymentGatewayEvent> {
    const data = await this.prisma.paymentGatewayEvent.update({
      where: { id },
      data: {
        status: 'PROCESSED' as GatewayEventStatus,
        paymentId: paymentId ?? undefined,
        error: null,
        processedAt: new Date(),
      },
    });

    return this.toDomain(data);
  }

  /**
   * Marca un evento como descartado
   */
  async markIgnored(id: string, reason?: string): Promise<PaymentGatewayEvent> {
    const data = await this.prisma.paymentGatewayEvent.update({
      where: { id },
      data: {
        status: 'IGNORED' as GatewayEventStatus,
        error: reason ?? null,
        processedAt: new Date(),
      },
    });

    return this.toDomain(data);
  }

  /**
   * Marca un evento como fallido
   */
  async markFailed(id: string, error: string): Promise<PaymentGatewayEvent> {
    const data = await this.prisma.paymentGatewayEvent.update({
      where: { id },
      data: {
        status: 'FAILED' as GatewayEventStatus,
        error,
        processedAt: new Date(),
      },
    });

    return this.toDomain(data);
  }

  /**
   * Busca un evento por el identificador que le asignó la pasarela
   */
  async findByEventId(
    provider: PaymentProviderEnum,
    eventId: string,
  ): Promise<PaymentGatewayEvent | null> {
    const data = await this.prisma.paymentGatewayEvent.findUnique({
      where: {
        provider_eventId: {
          provider: provider as PaymentProvider,
          eventId,
        },
      },
    });

    return data ? this.toDomain(data) : null;
  }

  /**
   * Convierte datos de Prisma a entidad de dominio
   */
  private toDomain(data: Prisma.PaymentGatewayEventGetPayload<object>): PaymentGatewayEvent {
    return new PaymentGatewayEvent({
      id: data.id,
      provider: data.provider as PaymentProviderEnum,
      eventId: data.eventId,
      eventType: data.eventType,
      paymentId: data.paymentId ?? undefined,
      status: data.status as GatewayEventStatusEnum,
      signatureValid: data.signatureValid,
      rawPayload: data.rawPayload,
      error: data.error ?? undefined,
      receivedAt: data.receivedAt,
      processedAt: data.processedAt ?? undefined,
    });
  }
}
