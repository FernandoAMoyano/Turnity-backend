import { centsToAmount } from '../../../src/shared/utils/money';

describe('centsToAmount', () => {
  // Debería convertir centavos a la unidad monetaria base
  it.each([
    [2500, 25],
    [2550, 25.5],
    [1999, 19.99],
    [1, 0.01],
    [0, 0],
  ])('should convert %i cents to %d', (cents, expected) => {
    expect(centsToAmount(cents)).toBe(expected);
  });

  // Debería rechazar un importe que no es entero
  it('should reject a non-integer amount', () => {
    expect(() => centsToAmount(25.5)).toThrow('Invalid amount in cents: 25.5');
  });

  // Debería rechazar un importe negativo
  it('should reject a negative amount', () => {
    expect(() => centsToAmount(-100)).toThrow('Invalid amount in cents: -100');
  });
});
