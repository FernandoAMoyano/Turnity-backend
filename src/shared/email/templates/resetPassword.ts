import { PasswordResetEmailContext } from '../EmailService';
import { RenderedEmail } from './RenderedEmail';
import { baseHtml } from './layout';

/**
 * Plantilla del email de recuperacion de password. Devuelve asunto + HTML + texto.
 * El enlace y la vigencia vienen del caller (use-case), no se calculan aca.
 */
export function renderPasswordResetEmail(ctx: PasswordResetEmailContext): RenderedEmail {
  const subject = 'Recupera tu contrasena — Turnity';

  const text = [
    `Hola ${ctx.name},`,
    '',
    'Recibimos una solicitud para restablecer la contrasena de tu cuenta en Turnity.',
    `Usa el siguiente enlace para elegir una nueva contrasena. Vence en ${ctx.expiresInMinutes} minutos:`,
    ctx.resetUrl,
    '',
    'Si no solicitaste este cambio, ignora este mensaje: tu contrasena seguira igual.',
  ].join('\n');

  const html = baseHtml({
    heading: 'Restablece tu contrasena',
    paragraphs: [
      `Hola ${ctx.name},`,
      'Recibimos una solicitud para restablecer la contrasena de tu cuenta en Turnity.',
      `Elegi una nueva contrasena con el boton de abajo. El enlace vence en ${ctx.expiresInMinutes} minutos.`,
    ],
    buttonLabel: 'Restablecer contrasena',
    url: ctx.resetUrl,
    footer: 'Si no solicitaste este cambio, ignora este mensaje: tu contrasena seguira igual.',
  });

  return { subject, html, text };
}
