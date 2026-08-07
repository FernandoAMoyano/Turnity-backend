import { Transporter } from 'nodemailer';
import {
  EmailService,
  VerificationEmailContext,
  PasswordResetEmailContext,
} from './EmailService';
import { RenderedEmail } from './templates/RenderedEmail';
import { renderVerificationEmail } from './templates/verifyEmail';
import { renderPasswordResetEmail } from './templates/resetPassword';
import { createEmailTransport, isRealTransport } from './transportFactory';
import { env } from '../config/env';
import { logger } from '../logger/logger';

/**
 * Implementacion de EmailService con nodemailer.
 *
 * El transporte se resuelve por entorno (ver `transportFactory`): mock en
 * test/dev-sin-SMTP, SMTP real en prod. El transporte es inyectable por
 * constructor para poder testear el adapter con un mock sin tocar env.
 */
export class NodemailerEmailService implements EmailService {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(transport: Transporter = createEmailTransport()) {
    this.transport = transport;
    // En produccion MAIL_FROM es obligatoria (env.ts); el fallback solo aplica
    // en dev/test donde el transporte no entrega mails reales.
    this.from = env.MAIL_FROM ?? 'no-reply@turnity.local';
  }

  async sendVerificationEmail(ctx: VerificationEmailContext): Promise<void> {
    const rendered = renderVerificationEmail(ctx);
    await this.deliver(ctx.to, rendered, ctx.verificationUrl);
  }

  async sendPasswordResetEmail(ctx: PasswordResetEmailContext): Promise<void> {
    const rendered = renderPasswordResetEmail(ctx);
    await this.deliver(ctx.to, rendered, ctx.resetUrl);
  }

  private async deliver(to: string, email: RenderedEmail, actionUrl: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    logger.info('[email] enviado', { to, subject: email.subject });

    // Fuera de produccion (o cuando el transporte no entrega de verdad) logueamos
    // el enlace para poder probar el flujo por API/Postman sin frontend.
    if (!isRealTransport()) {
      logger.debug(`[email] enlace para ${to}: ${actionUrl}`);
    }
  }
}
