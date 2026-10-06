/**
 * Turnity Backend - Sistema de Gestión para Salones de Belleza
 * Copyright (c) 2025 Fernando Moyano
 * Licensed under the MIT License
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { errorHandler } from './shared/middleware/ErrorHandler';
import { requestIdMiddleware } from './shared/middleware/RequestIdMiddleware';
import { prisma } from './shared/config/Prisma';
import { checkDatabaseReadiness } from './shared/health/ReadinessService';
import { AuthContainer } from './modules/auth/AuthContainer';
import { ServicesContainer } from './modules/services/ServicesContainer';
import { AppointmentContainer } from './modules/appointments/AppointmentContainer';
import { NotificationContainer } from './modules/notifications/NotificationContainer';
import { PaymentContainer } from './modules/payments/PaymentContainer';
import { HolidayContainer } from './modules/holidays/HolidayContainer';
import { setupSwagger } from './shared/middleware/swagger';

import dotenv from 'dotenv';
dotenv.config();

class App {
  public app: express.Application;
  private authContainer: AuthContainer;
  private serviceContainer: ServicesContainer;
  private appointmentContainer: AppointmentContainer;
  private notificationContainer: NotificationContainer;
  private paymentContainer: PaymentContainer;
  private holidayContainer: HolidayContainer;

  constructor() {
    this.app = express();
    this.authContainer = AuthContainer.getInstance(prisma);
    this.serviceContainer = ServicesContainer.getInstance(
      prisma,
      this.authContainer.authMiddleware,
    );
    this.appointmentContainer = AppointmentContainer.getInstance(
      prisma,
      this.authContainer.authMiddleware,
    );
    this.notificationContainer = NotificationContainer.getInstance(
      prisma,
      this.authContainer.authMiddleware,
    );
    this.paymentContainer = PaymentContainer.getInstance(prisma, this.authContainer.authMiddleware);
    this.holidayContainer = HolidayContainer.getInstance(prisma, this.authContainer.authMiddleware);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Confiar en el primer proxy de la cadena (Render termina TLS y hace
    // forwarding). Sin esto, req.ip es la IP del proxy en TODAS las requests:
    // el logging de IP miente y cualquier rate limiter por IP que se agregue
    // en el futuro agruparia a todo el mundo en un solo contador.
    this.app.set('trust proxy', 1);

    this.app.use(requestIdMiddleware);
    this.app.use(helmet());
    this.app.use(
      cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
      }),
    );

    // Parseo de cookies: habilita req.cookies para el refresh httpOnly y el
    // token CSRF (double-submit). -- F5b
    this.app.use(cookieParser());

    // Webhooks de pasarela: se montan ACA, entre cookieParser y express.json,
    // El router del webhook trae su propio express.raw({ type: 'application/json', limit: '1mb' })
    // para recibir el body sin parsear; si se montara despues (en setupRoutes, con el resto),
    // el express.json global de abajo lo habria parseado primero y el body
    // llegaria como objeto, con el limite de 10mb en vez de 1mb y sin los
    // bytes originales para auditar. Express matchea en orden: estas requests
    // responden aca y nunca alcanzan el parser global.
    // Ver src/modules/payments/presentation/routes/PaymentWebhookRoutes.ts
    // para el detalle de lo que este router deliberadamente NO tiene (JWT,
    // CSRF, rate limiter, express-validator).
    this.setupWebhookRoutes();

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    if (process.env.NODE_ENV !== 'test') {
      this.app.use(morgan('combined'));
    }
  }

  /**
   * Monta los routers que necesitan el body crudo, antes de los body-parsers
   * globales
   * @description Metodo aparte de setupRoutes(): lo que lo
   * distingue no es que sean rutas, sino EN QUE PUNTO de la cadena de
   * middlewares se montan. Ver el comentario de la invocacion en
   * setupMiddleware().
   */
  private setupWebhookRoutes(): void {
    this.app.use(
      '/api/v1/payments/webhooks',
      this.paymentContainer.paymentWebhookRoutes.getRouter(),
    );
  }

  private setupRoutes(): void {
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'Turnity API is running',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
      });
    });

    // Readiness probe: a diferencia de /health, esta si consulta la base de
    // datos (SELECT 1). Usado por el smoke check del CD, no como HEALTHCHECK
    // de Docker -- ver ReadinessService.ts para el detalle de esa decision.
    this.app.get('/ready', async (req, res) => {
      const isReady = await checkDatabaseReadiness(prisma);

      if (isReady) {
        res.status(200).json({
          success: true,
          checks: { database: 'up' },
        });
        return;
      }

      res.status(503).json({
        success: false,
        checks: { database: 'down' },
        code: 'NOT_READY',
      });
    });

    setupSwagger(this.app);

    this.app.use('/api/v1/auth', this.authContainer.authRoutes.getRouter());
    this.app.use('/api/v1', this.serviceContainer.servicesRoutes.getRouter());
    this.app.use('/api/v1/appointments', this.appointmentContainer.appointmentRoutes.getRouter());
    this.app.use(
      '/api/v1/notifications',
      this.notificationContainer.notificationRoutes.getRouter(),
    );
    // El mount de /api/v1/payments queda igual: nunca recibe las requests del
    // webhook, porque el router de /api/v1/payments/webhooks ya respondio
    // (montado en setupMiddleware, antes que esto).
    this.app.use('/api/v1/payments', this.paymentContainer.paymentRoutes.getRouter());
    this.app.use('/api/v1/holidays', this.holidayContainer.holidayRoutes.getRouter());

    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found`,
        code: 'ROUTE_NOT_FOUND',
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);
  }

  public getApp(): express.Application {
    return this.app;
  }
}

export default new App().getApp();
