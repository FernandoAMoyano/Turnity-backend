import { HandleGatewayWebhook } from '../../../../../src/modules/payments/application/use-cases/HandleGatewayWebhook';
import { IGatewayAwarePaymentRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentGatewayLookup';
import { IPaymentGatewayEventRepository } from '../../../../../src/modules/payments/domain/repositories/IPaymentGatewayEventRepository';
import { FakePaymentGateway } from '../../fakes/FakePaymentGateway';
import {
  Payment,
  PaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProviderEnum,
} from '../../../../../src/modules/payments/domain/entities/Payment';
import {
  PaymentGatewayEvent,
  GatewayEventStatusEnum,
} from '../../../../../src/modules/payments/domain/entities/PaymentGatewayEvent';

describe('HandleGatewayWebhook Use Case', () => {
  let handleGatewayWebhook: HandleGatewayWebhook;
  let mockPaymentRepository: jest.Mocked<IGatewayAwarePaymentRepository>;
  let mockEventRepository: jest.Mocked<IPaymentGatewayEventRepository>;
  let fakeGateway: FakePaymentGateway;

  const localPaymentId = '123e4567-e89b-12d3-a456-426614174001';
  const appointmentId = '123e4567-e89b-12d3-a456-426614174002';
  const gatewayPaymentId = '1234567890';
  const eventId = '98765';

  /** Body crudo de una notificación de Mercado Pago, tal como llegaría */
  const rawBody = Buffer.from(
    JSON.stringify({
      id: Number(eventId),
      live_mode: false,
      type: 'payment',
      date_created: '2026-09-03T10:04:58.396-03:00',
      user_id: 44444,
      api_version: 'v1',
      action: 'payment.updated',
      data: { id: gatewayPaymentId },
    }),
  );

  const dto = {
    rawBody,
    xSignature: 'ts=1757000000000,v1=abc123',
    xRequestId: 'req-abc-123',
    dataId: gatewayPaymentId,
  };

  /**
   * Arma un Payment respaldado por pasarela en el estado pedido, sin pasar por
   * los métodos de transición (que validan el estado de origen)
   */
  const gatewayPayment = (status: PaymentStatusEnum): Payment =>
    new Payment({
      id: localPaymentId,
      amount: 1500.5,
      status,
      method: status === PaymentStatusEnum.COMPLETED ? PaymentMethodEnum.ONLINE : null,
      paymentDate: null,
      appointmentId,
      createdAt: new Date('2026-09-03T10:00:00Z'),
      updatedAt: new Date('2026-09-03T10:00:00Z'),
      provider: PaymentProviderEnum.MERCADO_PAGO,
      idempotencyKey: 'idem-key-1',
    });

  beforeEach(() => {
    mockPaymentRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByAppointmentId: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getStatistics: jest.fn(),
      getTotalByAppointment: jest.fn(),
      findByGatewayPaymentId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
    };

    mockEventRepository = {
      saveIfNotExists: jest.fn(),
      markProcessed: jest.fn(),
      markIgnored: jest.fn(),
      markFailed: jest.fn(),
      findByEventId: jest.fn(),
    };

    fakeGateway = new FakePaymentGateway();
    fakeGateway.signatureValid = true;
    fakeGateway.notification = {
      eventType: 'payment',
      eventId,
      resourceId: gatewayPaymentId,
    };
    fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
      gatewayPaymentId,
      status: 'approved',
      externalReference: localPaymentId,
      amount: 1500.5,
    });

    // saveIfNotExists devuelve el mismo evento que recibe: es lo que hace la
    // implementación real cuando el (provider, eventId) todavía no existía.
    mockEventRepository.saveIfNotExists.mockImplementation(
      async (event: PaymentGatewayEvent) => event,
    );
    mockPaymentRepository.findById.mockResolvedValue(gatewayPayment(PaymentStatusEnum.PENDING));
    mockPaymentRepository.findByGatewayPaymentId.mockResolvedValue(null);
    mockPaymentRepository.update.mockImplementation(async (payment: Payment) => payment);

    handleGatewayWebhook = new HandleGatewayWebhook(
      mockPaymentRepository,
      mockEventRepository,
      fakeGateway,
    );
  });

  describe('verificación de firma', () => {
    // Debería rechazar con unauthorized y sin escribir nada si la firma no verifica
    it('should return unauthorized and write nothing when the signature is invalid', async () => {
      fakeGateway.signatureValid = false;

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('unauthorized');
      expect(mockEventRepository.saveIfNotExists).not.toHaveBeenCalled();
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(fakeGateway.getPaymentCalls).toHaveLength(0);
    });

    // Debería pasarle al gateway los tres valores del request sin normalizar
    it('should forward the raw signature inputs to the gateway', async () => {
      const spy = jest.spyOn(fakeGateway, 'verifyWebhookSignature');

      await handleGatewayWebhook.execute(dto);

      expect(spy).toHaveBeenCalledWith({
        xSignature: dto.xSignature,
        xRequestId: dto.xRequestId,
        dataId: dto.dataId,
      });
    });
  });

  describe('parseo del payload', () => {
    // Debería descartar (200) un payload malformado sin registrar el evento:
    // sin eventId no hay clave de deduplicación con la que insertarlo
    it('should ignore a malformed payload without persisting an event', async () => {
      fakeGateway.parseNotificationError = new Error('Malformed webhook payload: not valid JSON');

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('ignored');
      expect(result.detail).toContain('Malformed webhook payload');
      expect(mockEventRepository.saveIfNotExists).not.toHaveBeenCalled();
      expect(fakeGateway.getPaymentCalls).toHaveLength(0);
    });
  });

  describe('idempotencia entrante', () => {
    // Debería cortocircuitar como duplicate sin llamar al gateway cuando el
    // (provider, eventId) ya existía en la base
    it('should short-circuit as duplicate without re-fetching', async () => {
      mockEventRepository.saveIfNotExists.mockResolvedValue(null);

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('duplicate');
      expect(result.eventId).toBe(eventId);
      expect(fakeGateway.getPaymentCalls).toHaveLength(0);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
      expect(mockEventRepository.markProcessed).not.toHaveBeenCalled();
    });

    // Debería registrar el evento con el provider, el eventId, el eventType,
    // la firma válida y el payload crudo parseado
    it('should persist the incoming event with the raw payload', async () => {
      await handleGatewayWebhook.execute(dto);

      const [savedEvent] = mockEventRepository.saveIfNotExists.mock.calls[0];
      expect(savedEvent.provider).toBe(PaymentProviderEnum.MERCADO_PAGO);
      expect(savedEvent.eventId).toBe(eventId);
      expect(savedEvent.eventType).toBe('payment');
      expect(savedEvent.signatureValid).toBe(true);
      expect(savedEvent.status).toBe(GatewayEventStatusEnum.RECEIVED);
      expect(savedEvent.rawPayload).toEqual(JSON.parse(rawBody.toString('utf-8')));
    });
  });

  describe('tipos de notificación fuera de alcance', () => {
    // Debería registrar y descartar (200) una notificación que no es de pago,
    // sin gastar la llamada de red
    it('should record and ignore a non-payment event type', async () => {
      fakeGateway.notification = {
        eventType: 'merchant_order',
        eventId,
        resourceId: gatewayPaymentId,
      };

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('ignored');
      expect(result.detail).toContain('merchant_order');
      expect(mockEventRepository.markIgnored).toHaveBeenCalledTimes(1);
      expect(fakeGateway.getPaymentCalls).toHaveLength(0);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('camino feliz', () => {
    // Debería aplicar approved -> COMPLETED, persistir el pago y marcar el
    // evento como procesado con el id del pago local
    it('should apply approved as COMPLETED and mark the event processed', async () => {
      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('processed');
      expect(result.detail).toBe('applied');
      expect(result.paymentId).toBe(localPaymentId);

      const [updated] = mockPaymentRepository.update.mock.calls[0];
      expect(updated.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(updated.method).toBe(PaymentMethodEnum.ONLINE);
      expect(updated.paymentDate).not.toBeNull();
      expect(updated.gatewayStatus).toBe('approved');
      expect(updated.gatewayPaymentId).toBe(gatewayPaymentId);
      expect(updated.lastSyncedAt).toBeDefined();

      expect(mockEventRepository.markProcessed).toHaveBeenCalledWith(
        expect.any(String),
        localPaymentId,
      );
    });

    // Debería re-fetchear SIEMPRE y no confiar nunca en el estado del payload:
    // el body dice approved, la pasarela dice rejected, gana la pasarela
    it('should always re-fetch and never trust the payload status', async () => {
      fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
        gatewayPaymentId,
        status: 'rejected',
        statusDetail: 'cc_rejected_insufficient_amount',
        externalReference: localPaymentId,
      });

      const result = await handleGatewayWebhook.execute(dto);

      expect(fakeGateway.getPaymentCalls).toEqual([gatewayPaymentId]);
      expect(result.outcome).toBe('processed');

      const [updated] = mockPaymentRepository.update.mock.calls[0];
      expect(updated.status).toBe(PaymentStatusEnum.FAILED);
      expect(updated.failureReason).toBe('cc_rejected_insufficient_amount');
    });

    // Debería aplicar refunded sobre un pago COMPLETED (reembolso hecho desde
    // el panel de la pasarela, sin pasar por nuestra API)
    it('should apply refunded over a completed payment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(gatewayPayment(PaymentStatusEnum.COMPLETED));
      fakeGateway.paymentSnapshots.set(gatewayPaymentId, {
        gatewayPaymentId,
        status: 'refunded',
        externalReference: localPaymentId,
        refundedAmount: 1500.5,
      });

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('processed');
      const [updated] = mockPaymentRepository.update.mock.calls[0];
      expect(updated.status).toBe(PaymentStatusEnum.REFUNDED);
      expect(updated.refundedAmount).toBe(1500.5);
    });
  });

  describe('replays y transiciones imposibles', () => {
    // Debería devolver noop sin cambiar el estado ante un replay del mismo
    // evento sobre un pago ya COMPLETED (la dedup por base es la primera
    // defensa; esta es la segunda, dentro de la entidad)
    it('should be a noop when the payment is already in the target status', async () => {
      mockPaymentRepository.findById.mockResolvedValue(gatewayPayment(PaymentStatusEnum.COMPLETED));

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('processed');
      expect(result.detail).toBe('noop');
      const [updated] = mockPaymentRepository.update.mock.calls[0];
      expect(updated.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(mockEventRepository.markProcessed).toHaveBeenCalledTimes(1);
    });

    // Debería marcar conflict y NO revertir un pago ya reembolsado cuando
    // llega tarde el approved original
    it('should not revert a refunded payment when a late approved arrives', async () => {
      mockPaymentRepository.findById.mockResolvedValue(gatewayPayment(PaymentStatusEnum.REFUNDED));

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('processed');
      expect(result.detail).toBe('conflict');
      const [updated] = mockPaymentRepository.update.mock.calls[0];
      expect(updated.status).toBe(PaymentStatusEnum.REFUNDED);
      // El evento se marca PROCESSED y no IGNORED: sí corresponde a un pago
      // nuestro, y no hay nada que reintentar.
      expect(mockEventRepository.markProcessed).toHaveBeenCalledTimes(1);
      expect(mockEventRepository.markIgnored).not.toHaveBeenCalled();
    });
  });

  describe('resolución del pago local', () => {
    // Debería resolver el pago por external_reference (el Payment.id que
    // nosotros mandamos al crear la preferencia)
    it('should resolve the payment by external reference first', async () => {
      await handleGatewayWebhook.execute(dto);

      expect(mockPaymentRepository.findById).toHaveBeenCalledWith(localPaymentId);
      expect(mockPaymentRepository.findByGatewayPaymentId).not.toHaveBeenCalled();
    });

    // Debería caer a la búsqueda por gatewayPaymentId cuando el
    // external_reference no matchea ningún pago local
    it('should fall back to the gateway payment id', async () => {
      mockPaymentRepository.findById.mockResolvedValue(null);
      mockPaymentRepository.findByGatewayPaymentId.mockResolvedValue(
        gatewayPayment(PaymentStatusEnum.PENDING),
      );

      const result = await handleGatewayWebhook.execute(dto);

      expect(mockPaymentRepository.findByGatewayPaymentId).toHaveBeenCalledWith(gatewayPaymentId);
      expect(result.outcome).toBe('processed');
    });

    // Debería descartar (200) cuando la notificación no corresponde a ningún
    // pago local: reintentar no lo va a hacer aparecer
    it('should ignore a notification with no matching local payment', async () => {
      mockPaymentRepository.findById.mockResolvedValue(null);
      mockPaymentRepository.findByGatewayPaymentId.mockResolvedValue(null);

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('ignored');
      expect(mockEventRepository.markIgnored).toHaveBeenCalledTimes(1);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería descartar (200) cuando la pasarela no reconoce el recurso (404)
    it('should ignore a notification the gateway does not recognize', async () => {
      fakeGateway.paymentSnapshots.clear();

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('ignored');
      expect(result.detail).toContain(gatewayPaymentId);
      expect(mockEventRepository.markIgnored).toHaveBeenCalledTimes(1);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('fallos transitorios', () => {
    // Debería marcar el evento FAILED y devolver retryable (-> 500) cuando la
    // pasarela no responde al re-fetchear
    it('should mark the event failed and be retryable when the gateway times out', async () => {
      fakeGateway.getPaymentError = new Error('Gateway timeout after 10000ms');

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('retryable');
      expect(result.detail).toContain('timeout');
      expect(mockEventRepository.markFailed).toHaveBeenCalledTimes(1);
      expect(mockEventRepository.markProcessed).not.toHaveBeenCalled();
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    // Debería marcar el evento FAILED y devolver retryable cuando la base no
    // acepta la escritura del pago
    it('should mark the event failed and be retryable when persistence fails', async () => {
      mockPaymentRepository.update.mockRejectedValue(new Error('connection terminated'));

      const result = await handleGatewayWebhook.execute(dto);

      expect(result.outcome).toBe('retryable');
      expect(result.paymentId).toBe(localPaymentId);
      expect(mockEventRepository.markFailed).toHaveBeenCalledTimes(1);
      expect(mockEventRepository.markProcessed).not.toHaveBeenCalled();
    });
  });
});
