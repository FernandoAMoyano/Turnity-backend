/**
 * Resultado de renderizar una plantilla de email: asunto + cuerpo en HTML y
 * en texto plano (los clientes que no renderizan HTML usan el `text`).
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
