/**
 * Layout HTML minimo y responsive para emails transaccionales de Turnity.
 * Estilos inline (los clientes de correo ignoran <style> y CSS externo) y
 * estructura simple para maxima compatibilidad. El enlace se muestra ademas
 * como texto por si el boton no renderiza.
 */

/** Escapa texto para interpolarlo de forma segura dentro del HTML del email */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LayoutOptions {
  heading: string;
  /** Parrafos del cuerpo (ya en texto plano; se escapan aca) */
  paragraphs: string[];
  buttonLabel: string;
  url: string;
  /** Nota al pie (ej. "si no fuiste vos, ignora este mensaje") */
  footer: string;
}

export function baseHtml(opts: LayoutOptions): string {
  const safeUrl = escapeHtml(opts.url);
  const body = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 8px;font-size:20px;">Turnity</h1>
                <h2 style="margin:0 0 24px;font-size:16px;color:#3f3f46;">${escapeHtml(opts.heading)}</h2>
                ${body}
                <p style="margin:24px 0;">
                  <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">${escapeHtml(
                    opts.buttonLabel,
                  )}</a>
                </p>
                <p style="margin:0 0 16px;font-size:12px;color:#71717a;">
                  Si el boton no funciona, copia y pega este enlace en tu navegador:<br />
                  <a href="${safeUrl}" style="color:#4f46e5;word-break:break-all;">${safeUrl}</a>
                </p>
                <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
                <p style="margin:0;font-size:12px;color:#a1a1aa;">${escapeHtml(opts.footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
