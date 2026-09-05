import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  IPaymentGateway,
  CreateCheckoutInput,
  GatewayCheckout,
  GatewayPaymentSnapshot,
  GatewayRefund,
  GatewayNotification,
  WebhookSignatureInput,
} from '../../domain/gateways/IPaymentGateway';
import { logger } from '../../../../shared/logger/logger';

/**
 * Configuración necesaria para instanciar el adapter
 * @description Se inyecta por constructor en vez de leer `env` directamente,
 * para que el adapter sea testeable sin depender del módulo de configuración
 * global. El único punto que lee `env` es `PaymentGatewayFactory`.
 */
export interface MercadoPagoGatewayConfig {
  accessToken: string;
  webhookSecret: string;
  currency: string;
  publicApiUrl: string;
  frontendUrl: string;
  timeoutMs: number;
  signatureToleranceSeconds: number;
}

/** Vencimiento de la preferencia de checkout*/
const CHECKOUT_EXPIRATION_MINUTES = 30;

/** Cantidad de reintentos ante 5xx o error de red -- nunca ante 4xx */
const MAX_RETRIES = 1;

/** Forma mínima de la respuesta de POST /checkout/preferences que se consume */
interface MercadoPagoPreferenceResponse {
  id: string;
  init_point: string;
  sandbox_init_point: string;
}

/** Forma mínima de la respuesta de GET /v1/payments/{id} que se consume */
interface MercadoPagoPaymentResponse {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  date_last_updated?: string;
  transaction_details?: {
    total_refunded_amount?: number;
  };
}

/** Forma mínima de la respuesta de POST /v1/payments/{id}/refunds que se consume */
interface MercadoPagoRefundResponse {
  id: number | string;
  amount: number;
  status: string;
}

/**
 * Adapter de Mercado Pago para el puerto `IPaymentGateway`
 * @description Producción y sandbox son la misma clase: el modo lo calcula
 * el getter `isSandbox` (más abajo) leyendo el prefijo del `accessToken`
 * (`TEST-` = sandbox), nunca una variable de modo aparte -- una segunda
 * fuente de verdad podría desincronizarse del token, y el modo de fallo
 * (creer que estás en sandbox cobrando de verdad) es inaceptable.
 *
 * Sin SDK: `fetch` nativo de Node 20, cero dependencias npm
 * nuevas. Cuatro endpoints: crear preferencia, re-fetchear pago, crear
 * reembolso, y la verificación de firma (que no depende de HTTP).
 */
export class MercadoPagoGateway implements IPaymentGateway {
  private static readonly BASE_URL = 'https://api.mercadopago.com';

  /**
   * @param config - Credenciales y parámetros ya resueltos del adapter
   * (tipo `MercadoPagoGatewayConfig`): `accessToken` y `webhookSecret` de la
   * cuenta de Mercado Pago, `currency`/`publicApiUrl`/`frontendUrl`/
   * `timeoutMs`/`signatureToleranceSeconds` leídos de `env` por
   * `PaymentGatewayFactory` -- este constructor nunca lee `env` directamente,
   * por eso es testeable sin depender de la configuración global.
   * @param fetchImpl - Implementación de `fetch` a usar (tipo `typeof fetch`).
   * Por defecto el `fetch` global de Node 20; se inyecta uno distinto solo en
   * los tests, con un fake controlable que registra las llamadas.
   */
  constructor(
    private readonly config: MercadoPagoGatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    logger.info('[MercadoPagoGateway] inicializado', { isSandbox: this.isSandbox });
  }

  /**
   * Indica si el access token configurado es de sandbox (prefijo `TEST-`)
   */
  get isSandbox(): boolean {
    return this.config.accessToken.startsWith('TEST-');
  }

  /**
   * Crea la preferencia de checkout (Checkout Pro) en Mercado Pago
   * @description El `Payment.id` local viaja como `external_reference`, y las
   * `back_urls`/`notification_url` se arman desde `frontendUrl`/`publicApiUrl`
   * -- nunca desde valores hardcodeados. La preferencia vence a los 30 minutos.
   * @param input - Datos para armar la preferencia (tipo `CreateCheckoutInput`,
   * declarado en `IPaymentGateway.ts`):
   * - `paymentId` (`string`): ID del `Payment` local ya persistido -- lo arma
   *   el caso de uso `CreateCheckout`; viaja como `external_reference`
   *   de la preferencia, así el webhook siempre puede resolver el pago
   *   aunque `gatewayPaymentId` todavía no exista.
   * - `amount` (`number`): monto a cobrar, en la unidad monetaria base (la
   *   misma que `Payment.amount`, sin conversión a centavos -- ).
   * - `description` (`string`): texto que ve el pagador en el checkout
   *   hospedado; se manda como `items[0].title`.
   * - `idempotencyKey` (`string`): clave que arma el caso de uso al crear el
   *   `Payment`; viaja como header `X-Idempotency-Key` hacia Mercado Pago.
   * @returns `GatewayCheckout` con `checkoutUrl` (`sandbox_init_point` o
   * `init_point` de la respuesta de MP, según `isSandbox`),
   * `gatewayPreferenceId` (el `id` que devuelve Mercado Pago) y `expiresAt`
   * (calculado localmente: ahora + 30 minutos).
   * @throws Error si Mercado Pago responde con un status HTTP no exitoso
   * (ver `throwGatewayError`).
   */
  async createCheckout(input: CreateCheckoutInput): Promise<GatewayCheckout> {
    const expiresAt = new Date(Date.now() + CHECKOUT_EXPIRATION_MINUTES * 60_000);

    const body = {
      items: [
        {
          title: input.description,
          quantity: 1,
          unit_price: input.amount,
          currency_id: this.config.currency,
        },
      ],
      external_reference: input.paymentId,
      notification_url: `${this.config.publicApiUrl}/api/v1/payments/webhooks/mercadopago`,
      back_urls: {
        success: `${this.config.frontendUrl}/payments/success`,
        failure: `${this.config.frontendUrl}/payments/failure`,
        pending: `${this.config.frontendUrl}/payments/pending`,
      },
      auto_return: 'approved',
      expires: true,
      expiration_date_to: expiresAt.toISOString(),
    };

    const response = await this.request(`${MercadoPagoGateway.BASE_URL}/checkout/preferences`, {
      method: 'POST',
      headers: this.headers(input.idempotencyKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.throwGatewayError('creando la preferencia de checkout', response);
    }

    const data = (await response.json()) as MercadoPagoPreferenceResponse;

    return {
      checkoutUrl: this.isSandbox ? data.sandbox_init_point : data.init_point,
      gatewayPreferenceId: data.id,
      expiresAt,
    };
  }

  /**
   * Re-fetchea el estado autoritativo de un pago contra la API de Mercado
   * Pago (nunca se confía en el payload del webhook).
   *
   * @param gatewayPaymentId - ID del pago en Mercado Pago (`string`). Viene
   * de `Payment.gatewayPaymentId` una vez persistido, o del `resourceId` que
   * devuelve `parseWebhookNotification` a partir del `data.id` de una
   * notificación de webhook.
   * @returns El `GatewayPaymentSnapshot` mapeado desde la respuesta de
   * `GET /v1/payments/{id}`, o `null` si Mercado Pago responde 404 (el id no
   * existe para esta cuenta/credenciales).
   * @throws Error si la respuesta HTTP no es exitosa y tampoco es 404.
   */
  async getPayment(gatewayPaymentId: string): Promise<GatewayPaymentSnapshot | null> {
    const response = await this.request(
      `${MercadoPagoGateway.BASE_URL}/v1/payments/${gatewayPaymentId}`,
      {
        method: 'GET',
        headers: this.headers(),
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      await this.throwGatewayError('re-fetcheando el pago', response);
    }

    const data = (await response.json()) as MercadoPagoPaymentResponse;
    return this.toSnapshot(data);
  }

  /**
   * Ejecuta un reembolso total contra la API de Mercado Pago.
   *
   * @param gatewayPaymentId - ID del pago en Mercado Pago a reembolsar
   * (`string`), el mismo valor persistido en `Payment.gatewayPaymentId`.
   * @param idempotencyKey - Clave que evita un doble reembolso ante un
   * reintento (`string`); la arma el caso de uso `RefundPayment` y viaja
   * como header `X-Idempotency-Key`.
   * @returns `GatewayRefund` con `gatewayRefundId` (el `id` que devuelve
   * Mercado Pago para el reembolso), `amount` efectivamente reembolsado y
   * `status` colapsado a `'approved'` o `'pending'` (ver mapeo en el cuerpo).
   * @throws Error si Mercado Pago responde con un status HTTP no exitoso.
   */
  async refund(gatewayPaymentId: string, idempotencyKey: string): Promise<GatewayRefund> {
    const response = await this.request(
      `${MercadoPagoGateway.BASE_URL}/v1/payments/${gatewayPaymentId}/refunds`,
      {
        method: 'POST',
        headers: this.headers(idempotencyKey),
        body: JSON.stringify({}),
      },
    );

    if (!response.ok) {
      await this.throwGatewayError('creando el reembolso', response);
    }

    const data = (await response.json()) as MercadoPagoRefundResponse;

    return {
      gatewayRefundId: String(data.id),
      amount: data.amount,
      status: data.status === 'approved' ? 'approved' : 'pending',
    };
  }

  /**
   * Verifica la firma `x-signature` de una notificación de webhook
   *
   * @description Formato verificado contra la documentación vigente de
   * Mercado Pago.
   * - Header `x-signature`: `ts=<epoch-ms>,v1=<hex-hmac>`.
   * - Manifest: `id:{data.id en minúsculas};request-id:{x-request-id};ts:{ts};`
   *   -- orden fijo, `;` final incluido. Si falta algún valor, esa línea se
   *   omite del manifest en vez de dejarla vacía.
   * - `data.id` se normaliza a minúsculas antes de armar el manifest: la doc
   *   de MP es explícita en que se devuelve en mayúsculas pero debe enviarse
   *   en minúsculas.
   * - HMAC-SHA256 hex del manifest con el webhook secret, comparado con
   *   `timingSafeEqual` (mismo patrón que `CsrfMiddleware.safeEqual`).
   * Nunca lanza una excepción: cualquier header ausente o malformado resuelve a `false`.
   * @param input - Datos crudos del request (tipo `WebhookSignatureInput`,
   * declarado en `IPaymentGateway.ts`), sin normalizar -- la normalización la
   * hace este método, no el caller (el controller del webhook):
   * - `xSignature` (`string | undefined`): valor tal cual del header
   *   `x-signature` (`"ts=...,v1=..."`); `undefined` si el header no vino.
   * - `xRequestId` (`string | undefined`): valor tal cual del header
   *   `x-request-id`, que Mercado Pago asigna por notificación.
   * - `dataId` (`string | undefined`): el `data.id` de la query string del
   *   request del webhook (`?type=payment&data.id=...`).
   * @returns `true` solo si la firma es válida y el `ts` está dentro de
   * `signatureToleranceSeconds`; `false` en cualquier otro caso -- nunca lanza
   * una excepción (headers ausentes, malformados, o `v1` de longitud/hex inválido).
   * La unidad del `ts` se normaliza con `normalizeTsToMs` antes de medir la
   * ventana -- ver el comentario de ese método, la doc de MP se contradice
   * entre segundos y milisegundos y de eso depende que el endpoint no
   * devuelva 401 a todas las notificaciones reales.
   */
  verifyWebhookSignature(input: WebhookSignatureInput): boolean {
    if (!input.xSignature) {
      return false;
    }

    const parsed = this.parseXSignature(input.xSignature);
    if (!parsed) {
      return false;
    }

    const tsMs = MercadoPagoGateway.normalizeTsToMs(parsed.ts);
    if (tsMs === null) {
      return false;
    }

    const ageSeconds = Math.abs(Date.now() - tsMs) / 1000;
    if (ageSeconds > this.config.signatureToleranceSeconds) {
      return false;
    }

    const manifest = this.buildManifest({
      dataId: input.dataId,
      xRequestId: input.xRequestId,
      ts: parsed.ts,
    });

    const expected = createHmac('sha256', this.config.webhookSecret).update(manifest).digest('hex');

    return this.safeEqualHex(expected, parsed.v1);
  }

  /**
   * Parsea el body JSON crudo de una notificación de webhook de Mercado Pago
   * @param raw - Body tal como llegó, sin tocar por ningún body-parser
   * @returns `GatewayNotification` con `eventType` (el `type` del body, ej.
   * `"payment"`), `eventId` (el `id` propio de la notificación -- clave de
   * deduplicación en `PaymentGatewayEvent`, no confundir con el `id` del
   * pago) y `resourceId` (el `data.id`: el ID del recurso afectado, el que
   * después se re-fetchea con `getPayment`).
   * @throws Error si el body no es JSON válido o le faltan `type`, `id` o
   * `data.id`.
   */
  parseWebhookNotification(raw: Buffer): GatewayNotification {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf-8'));
    } catch {
      throw new Error('Malformed webhook payload: not valid JSON');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Malformed webhook payload: not an object');
    }

    const body = parsed as { type?: unknown; id?: unknown; data?: unknown };
    const data = body.data as { id?: unknown } | null | undefined;

    if (
      typeof body.type !== 'string' ||
      body.id === undefined ||
      body.id === null ||
      data === null ||
      typeof data !== 'object' ||
      data.id === undefined ||
      data.id === null
    ) {
      throw new Error('Malformed webhook payload: missing required fields (type, id, data.id)');
    }

    return {
      eventType: body.type,
      eventId: String(body.id),
      resourceId: String(data.id),
    };
  }

  /**
   * Ejecuta un fetch con timeout y un reintento ante 5xx o error de red
   *
   * @description Nunca reintenta ante 4xx: es un error del cliente, y
   * reintentar no lo va a corregir.
   * @param url - URL completa del endpoint de Mercado Pago a invocar
   * (`string`, ej. `` `${BASE_URL}/checkout/preferences` ``). La arma cada
   * método público (`createCheckout`/`getPayment`/`refund`).
   * @param init - Opciones de `fetch` ya armadas por el caller (`RequestInit`):
   * `method`, `headers` (de `this.headers()`) y `body` cuando aplica. Este
   * método le agrega el `signal` de timeout; el caller no lo setea.
   * @param attempt - Contador interno de reintentos (`number`, default `0`).
   * Nunca lo pasa el caller externo -- lo usa la propia recursión al
   * reintentar, hasta `MAX_RETRIES`.
   * @returns La `Response` de `fetch`, exitosa o no -- el caller decide qué
   * hacer con `response.ok` (ej. `throwGatewayError`).
   */
  private async request(url: string, init: RequestInit, attempt = 0): Promise<Response> {
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        return this.request(url, init, attempt + 1);
      }

      return response;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        return this.request(url, init, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Arma los headers comunes a toda request: autenticación Bearer y, cuando
   * corresponde, la clave de idempotencia hacia la pasarela
   *
   * @description Tipado como `Record<string, string>` y no como `HeadersInit`
   * a propósito: `@types/node` expone `fetch`/`RequestInit`/`Response` como
   * globales (vía `undici-types`), pero no promueve `HeadersInit` al
   * namespace global -- referenciarlo por nombre revienta la compilación sin
   * agregar `"dom"` a `tsconfig.json` (cambio global del proyecto, fuera de
   * esta fase). Un `Record<string, string>` es estructuralmente compatible
   * con lo que espera `fetch`.
   * @param idempotencyKey - Clave de idempotencia opcional (`string | undefined`).
   * La pasan `createCheckout` y `refund` (cada uno con la suya); `getPayment`
   * no pasa ninguna, porque un GET no crea nada del lado de Mercado Pago.
   * Cuando está definida se agrega el header `X-Idempotency-Key`; si no, el
   * header se omite por completo en vez de mandarse vacío.
   * @returns Los headers comunes a toda request: `Content-Type`,
   * `Authorization` (con `this.config.accessToken`) y, condicionalmente,
   * `X-Idempotency-Key`.
   */
  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.accessToken}`,
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    };
  }

  /**
   * Loguea el fallo y lanza un `Error`. El access token vive solo en el header
   * `Authorization`, que nunca se pasa a `logger` -- se registra el status y
   * un extracto acotado del cuerpo de error, nunca el request completo.
   * @param action - Frase corta en gerundio que describe la operación que
   * falló (`string`, ej. `"creando la preferencia de checkout"`). La arma
   * cada método público que la invoca; se usa tanto en el mensaje de log
   * como en el de la excepción.
   * @param response - La `Response` de `fetch` con `ok === false`, tal como
   * la devolvió Mercado Pago (este método solo se usa en las tres llamadas
   * salientes a la API de MP, nunca para la respuesta al webhook).
   * @throws Error - Siempre lo lanza (de ahí el tipo de retorno
   * `Promise<never>`); nunca hay un valor de éxito que devolver.
   */
  private async throwGatewayError(action: string, response: Response): Promise<never> {
    const body = await response.text().catch(() => '');
    logger.error(`[MercadoPagoGateway] fallo ${action}`, {
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new Error(`MercadoPago gateway error ${action}: HTTP ${response.status}`);
  }

  /**
   * Traduce la respuesta de `GET /v1/payments/{id}` al tipo del puerto
   * @param data - JSON ya parseado de la respuesta (tipo
   * `MercadoPagoPaymentResponse`, declarado arriba en este archivo -- es la
   * forma mínima que este adapter consume, no el objeto completo que
   * documenta la API de Mercado Pago).
   * @returns El `GatewayPaymentSnapshot` correspondiente (tipo declarado en
   * `IPaymentGateway.ts`), con los campos opcionales de MP normalizados a
   * `undefined` cuando faltan (nunca `null`, para que el `??` de
   * `applyGatewayStatus` en la entidad `Payment` los trate de forma uniforme).
   */
  private toSnapshot(data: MercadoPagoPaymentResponse): GatewayPaymentSnapshot {
    return {
      gatewayPaymentId: String(data.id),
      status: data.status,
      statusDetail: data.status_detail ?? undefined,
      externalReference: data.external_reference ?? undefined,
      amount: data.transaction_amount ?? undefined,
      refundedAmount: data.transaction_details?.total_refunded_amount ?? undefined,
      gatewayUpdatedAt: data.date_last_updated ? new Date(data.date_last_updated) : undefined,
    };
  }

  /**
   * Normaliza el `ts` de la firma a milisegundos, cualquiera sea la unidad
   * en que lo mande el proveedor
   * @description La documentación de Mercado Pago se contradice consigo misma
   * sobre este campo: las páginas de Checkout API y de suscripciones lo
   * describen como "timestamp in seconds" y lo ejemplifican con
   * `ts=1704908010` (10 dígitos), mientras que las de QR y Point dicen
   * "in milliseconds" y lo ejemplifican con `ts=1742505638683` (13 dígitos).
   * El `WebhookSignatureValidator` del SDK oficial de Node no chequea ninguna
   * ventana temporal, así que tampoco desempata. Asumir una sola unidad es un
   * fallo silencioso y total: si asumimos milisegundos y llegan segundos, la
   * resta contra `Date.now()` da ~1.7e9 segundos de antigüedad y el webhook
   * responde 401 a TODAS las notificaciones reales, con la firma válida.
   *
   * La unidad se deduce de la magnitud: cualquier epoch en segundos posterior
   * a 1970 y anterior al año 5138 es menor que 1e11, y cualquier epoch en
   * milisegundos posterior a 1973 es mayor. No hay ambigüedad posible en el
   * rango de fechas en que este código puede correr.
   *
   * Solo afecta al cálculo de la ventana de tolerancia. El manifest del HMAC
   * sigue usando el `ts` como string crudo, exactamente como llegó -- es lo
   * único que firma el proveedor, y normalizarlo ahí rompería la firma.
   * @param rawTs - Valor del campo `ts` tal como vino en `x-signature`
   * (`string`, sin convertir)
   * @returns El instante en milisegundos, o `null` si el valor no es un
   * número finito y positivo (nunca lanza una excepción: es el llamador el
   * que devuelve `false` en ese caso)
   */
  private static normalizeTsToMs(rawTs: string): number | null {
    /** Frontera entre epoch en segundos y epoch en milisegundos (ver arriba) */
    const SECONDS_MILLISECONDS_BOUNDARY = 1e11;

    const value = Number(rawTs);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value < SECONDS_MILLISECONDS_BOUNDARY ? value * 1000 : value;
  }

  /**
   * Parsea el header `x-signature` (`ts=...,v1=...`) en sus dos componentes
   * @param header - Valor crudo del header `x-signature`, tal como llega en
   * el request (`string`, formato `"ts=<epoch-ms>,v1=<hex>"`); es el mismo
   * valor que recibe `verifyWebhookSignature` en `input.xSignature`.
   * @returns `{ ts, v1 }` ya separados (ambos `string`, sin convertir), o
   * `null` si falta `ts` o `v1` -- header ausente de alguno de los dos, o
   * con un formato irreconocible (ej. sin la coma separadora).
   */
  private parseXSignature(header: string): { ts: string; v1: string } | null {
    const parts = header.split(',').reduce<Record<string, string>>((acc, pair) => {
      const [key, value] = pair.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {});

    if (!parts.ts || !parts.v1) {
      return null;
    }

    return { ts: parts.ts, v1: parts.v1 };
  }

  /**
   * Arma el manifest exacto que Mercado Pago firma
   * @description `id:{dataId};request-id:{xRequestId};ts:{ts};`, en ese
   * orden y con el `;` final. La línea de un valor ausente se omite en vez de
   * dejarla vacía (verificado contra la doc de MP, ver `verifyWebhookSignature`).
   * @param input - Los tres valores ya extraídos (no los headers crudos):
   * - `dataId` (`string | undefined`): el `input.dataId` de
   *   `verifyWebhookSignature`, todavía sin lowercasear -- ese `.toLowerCase()`
   *   lo hace este método, no el caller.
   * - `xRequestId` (`string | undefined`): el header `x-request-id` tal cual,
   *   sin transformar.
   * - `ts` (`string`): el `ts` ya extraído del header `x-signature` por
   *   `parseXSignature` -- a diferencia de los otros dos, es obligatorio
   *   (siempre forma parte del manifest).
   * @returns El manifest firmado, ej. `"id:mp123;request-id:req-1;ts:169...;"`,
   * con la línea de cualquier valor ausente omitida.
   */
  private buildManifest(input: { dataId?: string; xRequestId?: string; ts: string }): string {
    const lines: string[] = [];

    if (input.dataId) {
      lines.push(`id:${input.dataId.toLowerCase()}`);
    }
    if (input.xRequestId) {
      lines.push(`request-id:${input.xRequestId}`);
    }
    lines.push(`ts:${input.ts}`);

    return `${lines.join(';')};`;
  }

  /**
   * Comparación en tiempo constante de dos hex digests
   * @description Mismo criterio que `CsrfMiddleware.safeEqual`: longitudes
   * distintas (incluida una `v1` que no es hex válido, que `Buffer.from`
   * trunca en vez de lanzar un error) resuelven a `false` sin invocar
   * `timingSafeEqual`, que lanzaría un error ante un largo distinto.
   * @param expectedHex - HMAC-SHA256 calculado por este adapter, en hex
   * (`string`); nunca lo provee quien manda el request, siempre se calcula
   * localmente a partir del manifest y `config.webhookSecret`.
   * @param receivedHex - El `v1` recibido en el header `x-signature`
   * (`string`), tal como lo mandó quien hizo el request -- puede ser
   * cualquier cosa, incluido hex inválido o de longitud distinta; por eso
   * nunca se le aplica `timingSafeEqual` sin antes chequear longitudes.
   * @returns `true` solo si ambos, decodificados de hex, tienen la misma
   * longitud (mayor a 0) y son iguales byte a byte.
   */
  private safeEqualHex(expectedHex: string, receivedHex: string): boolean {
    const expected = Buffer.from(expectedHex, 'hex');
    const received = Buffer.from(receivedHex, 'hex');

    if (expected.length === 0 || received.length === 0 || expected.length !== received.length) {
      return false;
    }

    return timingSafeEqual(expected, received);
  }
}
