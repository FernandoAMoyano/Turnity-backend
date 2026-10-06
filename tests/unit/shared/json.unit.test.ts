import { parseJsonPreservingLargeIntegers } from '../../../src/shared/utils/json';

describe('parseJsonPreservingLargeIntegers', () => {
  // Debería conservar como string, con sus dígitos exactos, un entero fuera del rango seguro
  it('should keep an integer above Number.MAX_SAFE_INTEGER as an exact string', () => {
    const parsed = parseJsonPreservingLargeIntegers('{"id":39832227101597548}');

    expect(parsed).toEqual({ id: '39832227101597548' });
  });

  // Debería conservar como string un entero negativo fuera del rango seguro
  it('should keep a negative integer below Number.MIN_SAFE_INTEGER as an exact string', () => {
    const parsed = parseJsonPreservingLargeIntegers('{"value":-39832227101597548}');

    expect(parsed).toEqual({ value: '-39832227101597548' });
  });

  // Debería dejar como number los enteros dentro del rango seguro, incluido el límite
  it('should leave safe integers as numbers, including Number.MAX_SAFE_INTEGER itself', () => {
    const parsed = parseJsonPreservingLargeIntegers(
      '{"small":123456,"negative":-42,"zero":0,"limit":9007199254740991}',
    );

    expect(parsed).toEqual({
      small: 123456,
      negative: -42,
      zero: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
  });

  // Debería dejar como number los números con parte decimal o exponente
  it('should leave numbers with a fraction or an exponent as numbers', () => {
    const parsed = parseJsonPreservingLargeIntegers('{"amount":2500.5,"big":1e21,"tiny":-1.5E-3}');

    expect(parsed).toEqual({ amount: 2500.5, big: 1e21, tiny: -1.5e-3 });
  });

  // Debería ignorar los dígitos dentro de un string, incluidas las comillas escapadas
  it('should not touch digits inside strings, including escaped quotes', () => {
    const text = '{"note":"ref \\"39832227101597548\\" y 39832227101597548","id":"182041525194"}';

    const parsed = parseJsonPreservingLargeIntegers(text);

    expect(parsed).toEqual({
      note: 'ref "39832227101597548" y 39832227101597548',
      id: '182041525194',
    });
  });

  // Debería convertir los enteros fuera del rango seguro en objetos y arrays anidados
  it('should handle unsafe integers inside nested objects and arrays', () => {
    const parsed = parseJsonPreservingLargeIntegers(
      '{"data":{"ids":[1,39830243111915842,{"id":39832227101597548}]},"ok":true,"none":null}',
    );

    expect(parsed).toEqual({
      data: { ids: [1, '39830243111915842', { id: '39832227101597548' }] },
      ok: true,
      none: null,
    });
  });

  // Debería devolver el mismo resultado que JSON.parse cuando no hay enteros fuera del rango seguro
  it('should match JSON.parse when there are no unsafe integers', () => {
    const text =
      '{"action":"payment.updated","data":{"id":"123456"},"id":"123456","live_mode":false}';

    expect(parseJsonPreservingLargeIntegers(text)).toEqual(JSON.parse(text));
  });

  // Debería lanzar SyntaxError ante JSON inválido, igual que JSON.parse
  it('should throw a SyntaxError on invalid JSON', () => {
    expect(() => parseJsonPreservingLargeIntegers('not-json{{{')).toThrow(SyntaxError);
    expect(() => parseJsonPreservingLargeIntegers('{"id":39832227101597548')).toThrow(SyntaxError);
  });
});
