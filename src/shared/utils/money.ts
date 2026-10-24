/**
 * Convierte un importe en centavos a la unidad monetaria base
 * @description Los precios de los servicios se guardan como enteros en
 * centavos, mientras que los pagos y la pasarela trabajan en la unidad
 * monetaria base con dos decimales. Esta función es el único punto donde se
 * pasa de una representación a la otra.
 * @param cents - Importe en centavos, entero y no negativo
 * @returns El mismo importe en la unidad monetaria base (por ejemplo, 2550 → 25.5)
 * @throws Error si el importe no es un entero o es negativo
 */
export function centsToAmount(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Invalid amount in cents: ${cents}`);
  }
  return cents / 100;
}
