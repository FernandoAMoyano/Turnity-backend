/**
 * Parseo de JSON sin pérdida de precisión en enteros grandes
 * @description `JSON.parse` convierte todo número a `number` (IEEE 754), que
 * representa enteros exactos solo hasta `Number.MAX_SAFE_INTEGER`
 * (9007199254740991). Un entero más grande se redondea en silencio: por
 * ejemplo, `39830243111915842` queda como `39830243111915840`. Algunos
 * proveedores mandan identificadores de 17 dígitos como número JSON, y si esos
 * identificadores se usan como clave de deduplicación o se guardan para
 * auditoría, el redondeo los vuelve incorrectos.
 *
 * Este helper recorre el texto una sola vez y convierte en string todo literal
 * entero fuera del rango seguro, antes de delegar en `JSON.parse`. Los enteros
 * dentro del rango y los números con parte decimal o exponente quedan como
 * `number`. El recorrido ignora el contenido de los strings, incluidas las
 * comillas escapadas, así que nunca modifica un valor de texto.
 * @param text - Texto JSON a parsear
 * @returns El valor parseado, con los enteros fuera del rango seguro como string
 * @throws SyntaxError si el texto no es JSON válido, igual que `JSON.parse`
 */
export function parseJsonPreservingLargeIntegers(text: string): unknown {
  return JSON.parse(quoteUnsafeIntegers(text));
}

/** Caracteres que pueden formar parte de un literal numérico JSON */
const NUMBER_CHAR = /[0-9eE.+-]/;

/** Literal entero, opcionalmente negativo, sin parte decimal ni exponente */
const INTEGER_LITERAL = /^-?\d+$/;

/**
 * Envuelve entre comillas los literales enteros fuera del rango seguro
 * @description No valida el JSON: si el texto es inválido, la salida también
 * lo es y `JSON.parse` lanza el error correspondiente.
 * @param text - Texto JSON original
 * @returns El mismo texto, con los enteros fuera del rango seguro como string
 */
function quoteUnsafeIntegers(text: string): string {
  let result = '';
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === '"') {
      const end = findStringEnd(text, index);
      result += text.slice(index, end);
      index = end;
      continue;
    }

    if (char === '-' || (char >= '0' && char <= '9')) {
      let end = index + 1;
      while (end < text.length && NUMBER_CHAR.test(text[end])) {
        end++;
      }
      const literal = text.slice(index, end);
      const isUnsafeInteger =
        INTEGER_LITERAL.test(literal) && !Number.isSafeInteger(Number(literal));
      result += isUnsafeInteger ? `"${literal}"` : literal;
      index = end;
      continue;
    }

    result += char;
    index++;
  }

  return result;
}

/**
 * Devuelve la posición siguiente a la comilla que cierra un string JSON
 * @param text - Texto JSON original
 * @param start - Posición de la comilla que abre el string
 * @returns La posición siguiente a la comilla de cierre, o el largo del texto
 * si el string no se cierra
 */
function findStringEnd(text: string, start: number): number {
  let index = start + 1;

  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '"') {
      return index + 1;
    }
    index++;
  }

  return text.length;
}
