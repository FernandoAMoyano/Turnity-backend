/**
 * Guarda de seguridad para el script de sembrado (`prisma/seed.ts`).
 *
 * El seed borra TODOS los datos existentes y crea usuarios con contraseñas
 * conocidas (admin@turnity.com/admin123, etc.). Nunca debe correr contra una
 * base de datos de producción. Se extrae a un módulo aparte para poder
 * testearla sin conectar a una base de datos real ni ejecutar `main()`.
 *
 * @param nodeEnv Valor actual de `process.env.NODE_ENV`.
 * @throws Error si `nodeEnv` es `'production'`.
 */
export const assertSeedIsAllowed = (nodeEnv: string | undefined): void => {
  if (nodeEnv === 'production') {
    throw new Error(
      'El seed de desarrollo no puede correr con NODE_ENV=production: borra todos los ' +
        'datos existentes y crea usuarios con contraseñas conocidas. Abortando.',
    );
  }
};
