import { PrismaClient } from '@prisma/client';

// Repository
import { IPaymentRepository } from './domain/repositories/IPaymentRepository';
import { IGatewayAwarePaymentRepository } from './domain/repositories/IPaymentGatewayLookup';
import { IPaymentGatewayEventRepository } from './domain/repositories/IPaymentGatewayEventRepository';
import { PrismaPaymentRepository } from './infrastructure/persistence/PrismaPaymentRepository';
import { PrismaPaymentGatewayEventRepository } from './infrastructure/persistence/PrismaPaymentGatewayEventRepository';

// Repositorios de módulos externos
import { IAppointmentRepository } from '../appointments/domain/repositories/IAppointmentRepository';
import { IAppointmentStatusRepository } from '../appointments/domain/repositories/IAppointmentStatusRepository';
import { PrismaAppointmentRepository } from '../appointments/infrastructure/persistence/PrismaAppointmentRepository';
import { PrismaAppointmentStatusRepository } from '../appointments/infrastructure/persistence/PrismaAppointmentStatusRepository';

// Gateway de pago
import { IPaymentGateway } from './domain/gateways/IPaymentGateway';
import { createPaymentGateway } from './infrastructure/gateways/PaymentGatewayFactory';

// Use Cases
import { CreatePayment } from './application/use-cases/CreatePayment';
import { CreateCheckout } from './application/use-cases/CreateCheckout';
import { HandleGatewayWebhook } from './application/use-cases/HandleGatewayWebhook';
import { GetPaymentById } from './application/use-cases/GetPaymentById';
import { GetPaymentsByAppointment } from './application/use-cases/GetPaymentsByAppointment';
import { GetPayments } from './application/use-cases/GetPayments';
import { ProcessPayment } from './application/use-cases/ProcessPayment';
import { RefundPayment } from './application/use-cases/RefundPayment';
import { CancelPayment } from './application/use-cases/CancelPayment';
import { GetPaymentStatistics } from './application/use-cases/GetPaymentStatistics';
import { UpdatePayment } from './application/use-cases/UpdatePayment';

// Presentation
import { PaymentController } from './presentation/controllers/PaymentController';
import { PaymentWebhookController } from './presentation/controllers/PaymentWebhookController';
import { PaymentRoutes } from './presentation/routes/PaymentRoutes';
import { PaymentWebhookRoutes } from './presentation/routes/PaymentWebhookRoutes';
import { AuthMiddleware } from '../auth/presentation/middleware/AuthMiddleware';

/**
 * Contenedor de dependencias para el módulo de pagos
 * @description Implementa el patrón Singleton y configura todas las dependencias del módulo
 * usando inyección de dependencias manual siguiendo Clean Architecture
 */
export class PaymentContainer {
  /** Instancia singleton del contenedor */
  private static instance: PaymentContainer;

  // Repository
  // Tipado como IGatewayAwarePaymentRepository (superset de IPaymentRepository,
  // ver IPaymentGatewayLookup.ts): PrismaPaymentRepository ya implementa ambas
  // interfaces, y CreateCheckout necesita findByIdempotencyKey.
  private _paymentRepository: IGatewayAwarePaymentRepository;

  // Repositorio de eventos de pasarela: idempotencia entrante del webhook.
  private _paymentGatewayEventRepository: IPaymentGatewayEventRepository;

  // Repositorios externos
  private _appointmentRepository: IAppointmentRepository;
  private _appointmentStatusRepository: IAppointmentStatusRepository;

  // Gateway de pago
  private _paymentGateway: IPaymentGateway;

  // Use Cases
  private _createPayment: CreatePayment;
  private _createCheckout: CreateCheckout;
  private _handleGatewayWebhook: HandleGatewayWebhook;
  private _getPaymentById: GetPaymentById;
  private _getPaymentsByAppointment: GetPaymentsByAppointment;
  private _getPayments: GetPayments;
  private _processPayment: ProcessPayment;
  private _refundPayment: RefundPayment;
  private _cancelPayment: CancelPayment;
  private _getPaymentStatistics: GetPaymentStatistics;
  private _updatePayment: UpdatePayment;

  // Presentation
  private _paymentController: PaymentController;
  private _paymentWebhookController: PaymentWebhookController;
  private _paymentRoutes: PaymentRoutes;
  private _paymentWebhookRoutes: PaymentWebhookRoutes;

  /**
   * Constructor privado que inicializa todas las dependencias del módulo
   * @param prisma - Cliente Prisma para acceso a base de datos
   * @param authMiddleware - Middleware de autenticación del módulo auth
   */
  private constructor(
    private prisma: PrismaClient,
    private authMiddleware: AuthMiddleware,
  ) {
    this.setupDependencies();
  }

  /**
   * Obtiene la instancia singleton del contenedor
   * @param prisma - Cliente Prisma para inicialización
   * @param authMiddleware - Middleware de autenticación
   * @returns Instancia única del PaymentContainer
   */
  static getInstance(prisma: PrismaClient, authMiddleware: AuthMiddleware): PaymentContainer {
    if (!PaymentContainer.instance) {
      PaymentContainer.instance = new PaymentContainer(prisma, authMiddleware);
    }
    return PaymentContainer.instance;
  }

  /**
   * Configura todas las dependencias del módulo de pagos
   * @private
   */
  private setupDependencies(): void {
    // 1. Inicializar repositorios
    this._paymentRepository = new PrismaPaymentRepository(this.prisma);
    this._paymentGatewayEventRepository = new PrismaPaymentGatewayEventRepository(this.prisma);
    this._appointmentRepository = new PrismaAppointmentRepository(this.prisma);
    this._appointmentStatusRepository = new PrismaAppointmentStatusRepository(this.prisma);

    // 2. Resolver el gateway de pago (único punto de decisión: F2, D-F2.1)
    this._paymentGateway = createPaymentGateway();

    // 3. Inicializar use cases
    this._createPayment = new CreatePayment(
      this._paymentRepository,
      this._appointmentRepository,
      this._appointmentStatusRepository,
    );
    this._createCheckout = new CreateCheckout(
      this._paymentRepository,
      this._appointmentRepository,
      this._appointmentStatusRepository,
      this._paymentGateway,
    );
    this._handleGatewayWebhook = new HandleGatewayWebhook(
      this._paymentRepository,
      this._paymentGatewayEventRepository,
      this._paymentGateway,
    );
    this._getPaymentById = new GetPaymentById(
      this._paymentRepository,
      this._appointmentRepository,
    );
    this._getPaymentsByAppointment = new GetPaymentsByAppointment(
      this._paymentRepository,
      this._appointmentRepository,
    );
    this._getPayments = new GetPayments(this._paymentRepository);
    this._processPayment = new ProcessPayment(this._paymentRepository, this._appointmentRepository);
    this._refundPayment = new RefundPayment(this._paymentRepository, this._appointmentRepository);
    this._cancelPayment = new CancelPayment(this._paymentRepository, this._appointmentRepository);
    this._getPaymentStatistics = new GetPaymentStatistics(this._paymentRepository);
    this._updatePayment = new UpdatePayment(this._paymentRepository);

    // 4. Inicializar controller
    this._paymentController = new PaymentController(
      this._createPayment,
      this._createCheckout,
      this._getPaymentById,
      this._getPaymentsByAppointment,
      this._getPayments,
      this._processPayment,
      this._refundPayment,
      this._cancelPayment,
      this._getPaymentStatistics,
      this._updatePayment,
    );

    this._paymentWebhookController = new PaymentWebhookController(this._handleGatewayWebhook);

    // 5. Inicializar routes
    this._paymentRoutes = new PaymentRoutes(
      this._paymentController,
      this.authMiddleware,
    );

    // El router del webhook NO recibe authMiddleware: es un endpoint público
    // autenticado por firma HMAC, no por JWT (ver PaymentWebhookRoutes.ts).
    this._paymentWebhookRoutes = new PaymentWebhookRoutes(this._paymentWebhookController);
  }

  // =====================
  // GETTERS - PRESENTATION
  // =====================

  get paymentRoutes(): PaymentRoutes {
    return this._paymentRoutes;
  }

  get paymentController(): PaymentController {
    return this._paymentController;
  }

  /**
   * Router del webhook de la pasarela
   * @description Getter aparte de `paymentRoutes` porque `app.ts` lo monta en
   * otro lugar de la cadena de middlewares: antes del `express.json` global,
   * para que el body llegue crudo.
   */
  get paymentWebhookRoutes(): PaymentWebhookRoutes {
    return this._paymentWebhookRoutes;
  }

  get paymentWebhookController(): PaymentWebhookController {
    return this._paymentWebhookController;
  }

  // =====================
  // GETTERS - USE CASES
  // =====================

  get createPayment(): CreatePayment {
    return this._createPayment;
  }

  get createCheckout(): CreateCheckout {
    return this._createCheckout;
  }

  get handleGatewayWebhook(): HandleGatewayWebhook {
    return this._handleGatewayWebhook;
  }

  get getPaymentById(): GetPaymentById {
    return this._getPaymentById;
  }

  get getPaymentsByAppointment(): GetPaymentsByAppointment {
    return this._getPaymentsByAppointment;
  }

  get getPayments(): GetPayments {
    return this._getPayments;
  }

  get processPayment(): ProcessPayment {
    return this._processPayment;
  }

  get refundPayment(): RefundPayment {
    return this._refundPayment;
  }

  get cancelPayment(): CancelPayment {
    return this._cancelPayment;
  }

  get getPaymentStatistics(): GetPaymentStatistics {
    return this._getPaymentStatistics;
  }

  get updatePayment(): UpdatePayment {
    return this._updatePayment;
  }

  // =====================
  // GETTERS - REPOSITORY
  // =====================

  get paymentRepository(): IPaymentRepository {
    return this._paymentRepository;
  }

  get paymentGatewayEventRepository(): IPaymentGatewayEventRepository {
    return this._paymentGatewayEventRepository;
  }

  // =====================
  // GETTERS - GATEWAY
  // =====================

  get paymentGateway(): IPaymentGateway {
    return this._paymentGateway;
  }
}
