import {
  Payment,
  PaymentProps,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';

describe('Payment Entity - Integración con pasarela', () => {
  const paymentId = '123e4567-e89b-12d3-a456-426614174000';
  const appointmentId = '123e4567-e89b-12d3-a456-426614174001';
  const idempotencyKey = '123e4567-e89b-12d3-a456-426614174002';

  // Datos de prueba base de un pago respaldado por pasarela
  const gatewayPaymentProps: PaymentProps = {
    id: paymentId,
    amount: 1500.5,
    status: PaymentStatusEnum.PENDING,
    method: null,
    paymentDate: null,
    appointmentId,
    provider: PaymentProviderEnum.MERCADO_PAGO,
    idempotencyKey,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
  };

  describe('isGatewayBacked', () => {
    // Debería ser true cuando el proveedor no es MANUAL
    it('should return true when provider is not MANUAL', () => {
      const payment = new Payment(gatewayPaymentProps);

      expect(payment.provider).toBe(PaymentProviderEnum.MERCADO_PAGO);
      expect(payment.isGatewayBacked).toBe(true);
    });

    // Debería ser false cuando el proveedor es MANUAL
    it('should return false when provider is MANUAL', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        provider: PaymentProviderEnum.MANUAL,
      });

      expect(payment.isGatewayBacked).toBe(false);
    });

    // Debería asumir MANUAL cuando no se informa proveedor (filas previas a la
    // integración, que no tienen el dato)
    it('should default to MANUAL when no provider is given', () => {
      const payment = new Payment({
        id: paymentId,
        amount: 100.5,
        status: PaymentStatusEnum.PENDING,
        method: null,
        paymentDate: null,
        appointmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(payment.provider).toBe(PaymentProviderEnum.MANUAL);
      expect(payment.isGatewayBacked).toBe(false);
    });
  });

  describe('Factory method createForGateway', () => {
    // Debería crear un pago PENDING respaldado por la pasarela
    it('should create a PENDING gateway-backed payment', () => {
      const payment = Payment.createForGateway(
        paymentId,
        1500.5,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );

      expect(payment.id).toBe(paymentId);
      expect(payment.amount).toBe(1500.5);
      expect(payment.appointmentId).toBe(appointmentId);
      expect(payment.provider).toBe(PaymentProviderEnum.MERCADO_PAGO);
      expect(payment.status).toBe(PaymentStatusEnum.PENDING);
      expect(payment.isGatewayBacked).toBe(true);
      expect(payment.idempotencyKey).toBe(idempotencyKey);
      expect(payment.method).toBeNull();
      expect(payment.paymentDate).toBeNull();
      expect(payment.createdAt).toBeInstanceOf(Date);
      expect(payment.updatedAt).toBeInstanceOf(Date);
    });

    // Debería nacer sin ninguna referencia remota: el pago se persiste antes de
    // llamar a la pasarela
    it('should start without any gateway reference', () => {
      const payment = Payment.createForGateway(
        paymentId,
        1500.5,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );

      expect(payment.gatewayPaymentId).toBeUndefined();
      expect(payment.gatewayPreferenceId).toBeUndefined();
      expect(payment.gatewayStatus).toBeUndefined();
      expect(payment.checkoutUrl).toBeUndefined();
      expect(payment.lastSyncedAt).toBeUndefined();
    });

    // Debería lanzar error si el monto es 0
    it('should throw error if amount is 0', () => {
      expect(() =>
        Payment.createForGateway(
          paymentId,
          0,
          appointmentId,
          PaymentProviderEnum.MERCADO_PAGO,
          idempotencyKey,
        ),
      ).toThrow('Amount must be greater than 0');
    });

    // Debería lanzar error si el monto es negativo
    it('should throw error if amount is negative', () => {
      expect(() =>
        Payment.createForGateway(
          paymentId,
          -100,
          appointmentId,
          PaymentProviderEnum.MERCADO_PAGO,
          idempotencyKey,
        ),
      ).toThrow('Amount must be greater than 0');
    });

    // Debería lanzar error si el proveedor es MANUAL
    it('should throw error if provider is MANUAL', () => {
      expect(() =>
        Payment.createForGateway(
          paymentId,
          1500.5,
          appointmentId,
          PaymentProviderEnum.MANUAL,
          idempotencyKey,
        ),
      ).toThrow('Gateway payments require a provider other than MANUAL');
    });

    // Debería lanzar error si falta la clave de idempotencia
    it('should throw error if idempotency key is missing', () => {
      expect(() =>
        Payment.createForGateway(
          paymentId,
          1500.5,
          appointmentId,
          PaymentProviderEnum.MERCADO_PAGO,
          '',
        ),
      ).toThrow('Idempotency key is required for gateway payments');
    });
  });

  describe('recordCheckoutCreated', () => {
    // Debería setear checkoutUrl y gatewayPreferenceId sobre un pago recién
    // creado con createForGateway, que nace sin ninguna referencia remota
    it('should set checkoutUrl and gatewayPreferenceId on a freshly created gateway payment', () => {
      const payment = Payment.createForGateway(
        paymentId,
        1500.5,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );

      payment.recordCheckoutCreated(
        'https://sandbox.mercadopago.com/checkout/fake',
        'fake-preference-id',
      );

      expect(payment.checkoutUrl).toBe('https://sandbox.mercadopago.com/checkout/fake');
      expect(payment.gatewayPreferenceId).toBe('fake-preference-id');
    });

    // No debería tocar el status ni ningún otro campo de la pasarela: es un
    // registro de referencias, no una transición de estado
    it('should not change status or other gateway fields', () => {
      const payment = Payment.createForGateway(
        paymentId,
        1500.5,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );

      payment.recordCheckoutCreated('https://example.com/checkout', 'pref-1');

      expect(payment.status).toBe(PaymentStatusEnum.PENDING);
      expect(payment.gatewayPaymentId).toBeUndefined();
      expect(payment.gatewayStatus).toBeUndefined();
    });

    // Debería actualizar updatedAt
    it('should bump updatedAt', () => {
      const payment = Payment.createForGateway(
        paymentId,
        1500.5,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );
      const before = payment.updatedAt;

      payment.recordCheckoutCreated('https://example.com/checkout', 'pref-1');

      expect(payment.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('markAsFailed con motivo (fallo al crear el checkout)', () => {
    // CreateCheckout marca FAILED con failureReason cuando la pasarela
    // rechaza la creación de la preferencia -- distinto del camino manual
    // (CancelPayment), que sigue llamando markAsFailed() sin argumentos
    it('should record the failure reason when provided', () => {
      const payment = Payment.createForGateway(
        paymentId,
        1500.5,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );

      payment.markAsFailed('Gateway rejected preference creation: invalid access token');

      expect(payment.status).toBe(PaymentStatusEnum.FAILED);
      expect(payment.failureReason).toBe(
        'Gateway rejected preference creation: invalid access token',
      );
    });

    // Sin motivo, se comporta exactamente igual que antes (CancelPayment)
    it('should leave failureReason undefined when no reason is given', () => {
      const payment = Payment.createForGateway(
        paymentId,
        1500.5,
        appointmentId,
        PaymentProviderEnum.MERCADO_PAGO,
        idempotencyKey,
      );

      payment.markAsFailed();

      expect(payment.status).toBe(PaymentStatusEnum.FAILED);
      expect(payment.failureReason).toBeUndefined();
    });

    // Debería seguir respetando la guarda de estado: solo PENDING puede fallar
    it('should still throw when the payment is not PENDING', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        status: PaymentStatusEnum.COMPLETED,
      });

      expect(() => payment.markAsFailed('some reason')).toThrow(
        'Only pending payments can be marked as failed',
      );
    });
  });

  describe('applyGatewayStatus - transiciones aplicadas', () => {
    // Debería completar un pago pendiente y dejarlo como cobro online
    it('should complete a pending payment and set ONLINE method', () => {
      const payment = new Payment(gatewayPaymentProps);

      const result = payment.applyGatewayStatus({
        status: PaymentStatusEnum.COMPLETED,
        gatewayStatus: 'approved',
        gatewayPaymentId: 'mp-123456',
      });

      expect(result).toBe('applied');
      expect(payment.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(payment.method).toBe(PaymentMethodEnum.ONLINE);
      expect(payment.paymentDate).toBeInstanceOf(Date);
      expect(payment.gatewayPaymentId).toBe('mp-123456');
      expect(payment.gatewayStatus).toBe('approved');
      expect(payment.lastSyncedAt).toBeInstanceOf(Date);
    });

    // Debería marcar como fallido un pago rechazado, con el motivo
    it('should fail a rejected payment and keep the failure reason', () => {
      const payment = new Payment(gatewayPaymentProps);

      const result = payment.applyGatewayStatus({
        status: PaymentStatusEnum.FAILED,
        gatewayStatus: 'rejected',
        failureReason: 'cc_rejected_insufficient_amount',
      });

      expect(result).toBe('applied');
      expect(payment.status).toBe(PaymentStatusEnum.FAILED);
      expect(payment.failureReason).toBe('cc_rejected_insufficient_amount');
      expect(payment.gatewayStatus).toBe('rejected');
    });

    // Debería reembolsar un pago completado, incluso si el reembolso se originó
    // fuera de la API
    it('should refund a completed payment', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        status: PaymentStatusEnum.COMPLETED,
        method: PaymentMethodEnum.ONLINE,
        paymentDate: new Date('2026-01-01T11:00:00Z'),
      });

      const result = payment.applyGatewayStatus({
        status: PaymentStatusEnum.REFUNDED,
        gatewayStatus: 'refunded',
        refundedAmount: 1500.5,
        gatewayRefundId: 'refund-999',
      });

      expect(result).toBe('applied');
      expect(payment.status).toBe(PaymentStatusEnum.REFUNDED);
      expect(payment.isRefunded).toBe(true);
      expect(payment.refundedAmount).toBe(1500.5);
      expect(payment.gatewayRefundId).toBe('refund-999');
    });

    // Debería corregir un pago marcado como fallido si la pasarela informa que
    // finalmente se cobró: la relectura remota es autoritativa
    it('should correct a failed payment when the gateway reports it approved', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        status: PaymentStatusEnum.FAILED,
        failureReason: 'cc_rejected_other_reason',
      });

      const result = payment.applyGatewayStatus({
        status: PaymentStatusEnum.COMPLETED,
        gatewayStatus: 'approved',
      });

      expect(result).toBe('applied');
      expect(payment.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(payment.method).toBe(PaymentMethodEnum.ONLINE);
      expect(payment.failureReason).toBeUndefined();
    });
  });

  describe('applyGatewayStatus - idempotencia y conflictos', () => {
    // Debería ser no-op ante un reintento de la pasarela sobre un pago ya
    // completado, sin lanzar
    it('should return noop without throwing on a replayed approved event', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        status: PaymentStatusEnum.COMPLETED,
        method: PaymentMethodEnum.ONLINE,
        paymentDate: new Date('2026-01-01T11:00:00Z'),
      });
      const paymentDateBefore = payment.paymentDate;

      const result = payment.applyGatewayStatus({
        status: PaymentStatusEnum.COMPLETED,
        gatewayStatus: 'approved',
      });

      expect(result).toBe('noop');
      expect(payment.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(payment.paymentDate).toEqual(paymentDateBefore);
    });

    // Debería rechazar sin lanzar una transición imposible desde REFUNDED
    it('should return conflict without throwing when going back from REFUNDED', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        status: PaymentStatusEnum.REFUNDED,
      });

      const result = payment.applyGatewayStatus({
        status: PaymentStatusEnum.COMPLETED,
        gatewayStatus: 'approved',
      });

      expect(result).toBe('conflict');
      expect(payment.status).toBe(PaymentStatusEnum.REFUNDED);
    });

    // Debería tratar REFUNDED como terminal para cualquier destino
    it('should treat REFUNDED as terminal for every target status', () => {
      const targets = [
        PaymentStatusEnum.PENDING,
        PaymentStatusEnum.COMPLETED,
        PaymentStatusEnum.FAILED,
      ];

      targets.forEach((status) => {
        const payment = new Payment({
          ...gatewayPaymentProps,
          status: PaymentStatusEnum.REFUNDED,
        });

        expect(payment.applyGatewayStatus({ status, gatewayStatus: 'whatever' })).toBe(
          'conflict',
        );
        expect(payment.status).toBe(PaymentStatusEnum.REFUNDED);
      });
    });

    // Debería rechazar que un pago cobrado vuelva a pendiente por una
    // notificación fuera de orden
    it('should not revert a completed payment back to PENDING', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        status: PaymentStatusEnum.COMPLETED,
        method: PaymentMethodEnum.ONLINE,
      });

      const result = payment.applyGatewayStatus({
        status: PaymentStatusEnum.PENDING,
        gatewayStatus: 'in_process',
      });

      expect(result).toBe('conflict');
      expect(payment.status).toBe(PaymentStatusEnum.COMPLETED);
    });

    // Debería refrescar los datos de auditoría incluso cuando la transición no
    // se aplica: la consulta a la pasarela ocurrió igual
    it('should refresh audit fields even on conflict', () => {
      const payment = new Payment({
        ...gatewayPaymentProps,
        status: PaymentStatusEnum.REFUNDED,
      });

      payment.applyGatewayStatus({
        status: PaymentStatusEnum.COMPLETED,
        gatewayStatus: 'charged_back',
        gatewayPaymentId: 'mp-654321',
      });

      expect(payment.gatewayStatus).toBe('charged_back');
      expect(payment.gatewayPaymentId).toBe('mp-654321');
      expect(payment.lastSyncedAt).toBeInstanceOf(Date);
    });

    // No debería lanzar una excepción nunca, sea cual sea la combinación de estados
    it('should never throw for any status combination', () => {
      const statuses = Object.values(PaymentStatusEnum);

      statuses.forEach((from) => {
        statuses.forEach((to) => {
          const payment = new Payment({ ...gatewayPaymentProps, status: from });

          expect(() =>
            payment.applyGatewayStatus({ status: to, gatewayStatus: 'any' }),
          ).not.toThrow();
        });
      });
    });
  });

  describe('Regresión del camino manual', () => {
    // El factory existente debería seguir produciendo pagos manuales
    it('should keep Payment.create producing MANUAL payments', () => {
      const payment = Payment.create(paymentId, 150.0, appointmentId);

      expect(payment.provider).toBe(PaymentProviderEnum.MANUAL);
      expect(payment.isGatewayBacked).toBe(false);
      expect(payment.status).toBe(PaymentStatusEnum.PENDING);
      expect(payment.idempotencyKey).toBeUndefined();
      expect(payment.gatewayPaymentId).toBeUndefined();
    });

    // Los métodos del camino manual deberían seguir lanzando igual que antes
    it('should keep manual transition guards throwing', () => {
      const completed = new Payment({
        ...gatewayPaymentProps,
        provider: PaymentProviderEnum.MANUAL,
        status: PaymentStatusEnum.COMPLETED,
      });

      expect(() => completed.markAsCompleted(PaymentMethodEnum.CASH)).toThrow(
        'Only pending payments can be completed',
      );
      expect(() => completed.markAsFailed()).toThrow(
        'Only pending payments can be marked as failed',
      );
      expect(() => completed.updateAmount(200)).toThrow(
        'Only pending payments can be updated',
      );
    });

    // toObject no debería exponer los campos de pasarela: no tiene consumidores
    // en src/ y la clave de idempotencia no puede filtrarse
    it('should keep toObject free of gateway fields', () => {
      const payment = new Payment(gatewayPaymentProps);
      const obj = payment.toObject();

      expect(obj).toEqual({
        id: paymentId,
        amount: 1500.5,
        status: PaymentStatusEnum.PENDING,
        method: null,
        paymentDate: null,
        appointmentId,
        createdAt: gatewayPaymentProps.createdAt,
        updatedAt: gatewayPaymentProps.updatedAt,
      });
      expect(Object.keys(obj)).not.toContain('idempotencyKey');
      expect(Object.keys(obj)).not.toContain('provider');
    });
  });

  describe('Enums', () => {
    // Debería tener todos los valores de PaymentProviderEnum
    it('should have all PaymentProviderEnum values', () => {
      expect(PaymentProviderEnum.MANUAL).toBe('MANUAL');
      expect(PaymentProviderEnum.MERCADO_PAGO).toBe('MERCADO_PAGO');
    });
  });
});
