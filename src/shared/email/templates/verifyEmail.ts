import { VerificationEmailContext } from '../EmailService';
import { RenderedEmail } from './RenderedEmail';
import { baseHtml } from './layout';

/**
 * Plantilla del email de verificacion de cuenta. Devuelve asunto + HTML + texto.
 * El enlace y la vigencia vienen del caller (use-case), no se calculan aca.
 */
export function renderVerificationEmail(ctx: VerificationEmailContext): RenderedEmail {
  const subject = 'Verifica tu email — Turnity';

  const text = [
    `Hola ${ctx.name},`,
    '',
    'Gracias por registrarte en Turnity. Confirma tu direccion de email para activar tu cuenta.',
    `El enlace vence en ${ctx.expiresInHours} horas:`,
    ctx.verificationUrl,
    '',
    'Si no creaste esta cuenta, podes ignorar este mensaje.',
  ].join('\n');

  const html = baseHtml({
    heading: 'Confirma tu email',
    paragraphs: [
      `Hola ${ctx.name},`,
      'Gracias por registrarte en Turnity. Confirma tu direccion de email para activar tu cuenta.',
      `El enlace vence en ${ctx.expiresInHours} horas.`,
    ],
    buttonLabel: 'Verificar mi email',
    url: ctx.verificationUrl,
    footer: 'Si no creaste esta cuenta, podes ignorar este mensaje.',
  });

  return { subject, html, text };
}
