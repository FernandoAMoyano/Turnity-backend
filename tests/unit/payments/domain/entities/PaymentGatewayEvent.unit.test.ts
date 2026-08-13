import { PaymentProviderEnum } from '../../../../../src/modules/payments/domain/entities/Payment';
import {
  PaymentGatewayEvent,
  PaymentGatewayEventProps,
  GatewayEventStatusEnum,
} from '../../../../../src/modules/payments/domain/entities/PaymentGatewayEvent';

describe('PaymentGatewayEvent Entity', () => {
  const eventUuid = '123e4567-e89b-12d3-a456-426614174000';
  const paymentId = '123e4567-e89b-12d3-a456-426614174001';
  const rawPayload = { action: 'payment.updated', data: { id: 'mp-123456' } };

  // Datos de prueba base
  const validEventProps: PaymentGatewayEventProps = {
    id: eventUuid,
    provider: PaymentProviderEnum.MERCADO_PAGO,
    eventId: 'notification-987654',
    eventType: 'payment',
    status: GatewayEventStatusEnum.RECEIVED,
    signatureValid: true,
    rawPayload,
    receivedAt: new Date('2026-01-01T10:00:00Z'),
  };

  describe('Constructor y Getters', () => {
    // Debería crear una entidad con todas las propiedades
    it('should create a PaymentGatewayEvent entity with all properties', () => {
      const event = new PaymentGatewayEvent(validEventProps);

      expect(event.id).toBe(eventUuid);
      expect(event.provider).toBe(PaymentProviderEnum.MERCADO_PAGO);
      expect(event.eventId).toBe('notification-987654');
      expect(event.eventType).toBe('payment');
      expect(event.status).toBe(GatewayEventStatusEnum.RECEIVED);
      expect(event.signatureValid).toBe(true);
      expect(event.rawPayload).toEqual(rawPayload);
      expect(event.receivedAt).toEqual(validEventProps.receivedAt);
      expect(event.paymentId).toBeUndefined();
      expect(event.processedAt).toBeUndefined();
      expect(event.error).toBeUndefined();
    });

    // Debería reportar isPending mientras el evento no llegó a estado terminal
    it('should report isPending while the event is not terminal', () => {
      const event = new PaymentGatewayEvent(validEventProps);

      expect(event.isPending).toBe(true);
      expect(event.isProcessed).toBe(false);
    });
  });

  describe('Factory method create', () => {
    // Debería registrar un evento recién recibido en estado RECEIVED
    it('should create a received event with RECEIVED status', () => {
      const event = PaymentGatewayEvent.create(
        eventUuid,
        PaymentProviderEnum.MERCADO_PAGO,
        'notification-987654',
        'payment',
        true,
        rawPayload,
      );

      expect(event.status).toBe(GatewayEventStatusEnum.RECEIVED);
      expect(event.signatureValid).toBe(true);
      expect(event.rawPayload).toEqual(rawPayload);
      expect(event.receivedAt).toBeInstanceOf(Date);
      expect(event.processedAt).toBeUndefined();
      expect(event.paymentId).toBeUndefined();
    });

    // Debería aceptar el ID del pago cuando ya se resolvió
    it('should accept an already resolved payment id', () => {
      const event = PaymentGatewayEvent.create(
        eventUuid,
        PaymentProviderEnum.MERCADO_PAGO,
        'notification-987654',
        'payment',
        true,
        rawPayload,
        paymentId,
      );

      expect(event.paymentId).toBe(paymentId);
    });

    // Debería registrar un evento con firma inválida sin rechazarlo: el
    // resultado de la verificación es un dato de auditoría
    it('should record an event with an invalid signature', () => {
      const event = PaymentGatewayEvent.create(
        eventUuid,
        PaymentProviderEnum.MERCADO_PAGO,
        'notification-987654',
        'payment',
        false,
        rawPayload,
      );

      expect(event.signatureValid).toBe(false);
      expect(event.status).toBe(GatewayEventStatusEnum.RECEIVED);
    });

    // Debería lanzar error si falta el identificador de la notificación
    it('should throw error if event id is missing', () => {
      expect(() =>
        PaymentGatewayEvent.create(
          eventUuid,
          PaymentProviderEnum.MERCADO_PAGO,
          '',
          'payment',
          true,
          rawPayload,
        ),
      ).toThrow('Event id is required');
    });

    // Debería lanzar error si falta el tipo de notificación
    it('should throw error if event type is missing', () => {
      expect(() =>
        PaymentGatewayEvent.create(
          eventUuid,
          PaymentProviderEnum.MERCADO_PAGO,
          'notification-987654',
          '',
          true,
          rawPayload,
        ),
      ).toThrow('Event type is required');
    });
  });

  describe('Transiciones de estado', () => {
    // Debería marcar el evento como procesado y vincularlo al pago
    it('should mark the event as processed and link the payment', () => {
      const event = new PaymentGatewayEvent(validEventProps);

      event.markAsProcessed(paymentId);

      expect(event.status).toBe(GatewayEventStatusEnum.PROCESSED);
      expect(event.isProcessed).toBe(true);
      expect(event.isPending).toBe(false);
      expect(event.paymentId).toBe(paymentId);
      expect(event.processedAt).toBeInstanceOf(Date);
    });

    // Debería marcar el evento como descartado con su motivo
    it('should mark the event as ignored with a reason', () => {
      const event = new PaymentGatewayEvent(validEventProps);

      event.markAsIgnored('Payment not found for external reference');

      expect(event.status).toBe(GatewayEventStatusEnum.IGNORED);
      expect(event.error).toBe('Payment not found for external reference');
      expect(event.processedAt).toBeInstanceOf(Date);
    });

    // Debería marcar el evento como fallido con el detalle del error
    it('should mark the event as failed with the error detail', () => {
      const event = new PaymentGatewayEvent(validEventProps);

      event.markAsFailed('Gateway timeout while re-fetching the payment');

      expect(event.status).toBe(GatewayEventStatusEnum.FAILED);
      expect(event.error).toBe('Gateway timeout while re-fetching the payment');
      expect(event.processedAt).toBeInstanceOf(Date);
    });

    // No debería lanzar al marcar dos veces: el manejador del webhook no puede
    // permitirse una excepción, porque devolvería 5xx y generaría más reintentos
    it('should not throw when a terminal transition is applied twice', () => {
      const event = new PaymentGatewayEvent(validEventProps);

      event.markAsProcessed(paymentId);

      expect(() => event.markAsProcessed(paymentId)).not.toThrow();
      expect(event.status).toBe(GatewayEventStatusEnum.PROCESSED);
    });

    // Debería conservar el ID del pago si no se informa uno nuevo
    it('should keep the existing payment id when none is given', () => {
      const event = new PaymentGatewayEvent({ ...validEventProps, paymentId });

      event.markAsProcessed();

      expect(event.paymentId).toBe(paymentId);
    });
  });

  describe('toObject', () => {
    // Debería convertir la entidad a un objeto plano
    it('should convert entity to plain object', () => {
      const event = new PaymentGatewayEvent(validEventProps);
      const obj = event.toObject();

      expect(obj).toEqual({
        id: eventUuid,
        provider: PaymentProviderEnum.MERCADO_PAGO,
        eventId: 'notification-987654',
        eventType: 'payment',
        paymentId: undefined,
        status: GatewayEventStatusEnum.RECEIVED,
        signatureValid: true,
        rawPayload,
        error: undefined,
        receivedAt: validEventProps.receivedAt,
        processedAt: undefined,
      });
    });
  });

  describe('Enums', () => {
    // Debería tener todos los valores de GatewayEventStatusEnum
    it('should have all GatewayEventStatusEnum values', () => {
      expect(GatewayEventStatusEnum.RECEIVED).toBe('RECEIVED');
      expect(GatewayEventStatusEnum.PROCESSED).toBe('PROCESSED');
      expect(GatewayEventStatusEnum.IGNORED).toBe('IGNORED');
      expect(GatewayEventStatusEnum.FAILED).toBe('FAILED');
    });
  });
});
