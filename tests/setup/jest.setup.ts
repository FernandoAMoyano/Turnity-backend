// Forzar NODE_ENV=test ANTES de cargar dotenv o cualquier modulo de la app.
// testEnvironmentOptions.NODE_ENV en jest.config.js NO tiene este efecto: esa opcion
// se pasa al constructor del entorno de test (el sandbox de jest-environment-node),
// nunca llega a process.env del proceso real que ejecuta los tests. Sin esta linea,
// NODE_ENV queda con el valor heredado del shell/contenedor (ej. 'development'), y
// todo lo que condiciona comportamiento en base a NODE_ENV === 'test' (morgan en
// app.ts, el logger de Winston) nunca se activa durante la suite de tests.
process.env.NODE_ENV = 'test';

// Exponer el token de verificacion/reset en las respuestas para que los tests de
// integracion puedan leerlo (mismo mecanismo que en dev por Postman). Se setea
// antes de dotenv/env.ts; en produccion el flag esta prohibido (validado en env.ts).
process.env.EXPOSE_VERIFICATION_TOKENS = 'true';

import dotenv from 'dotenv';

// dotenv.config() no sobreescribe variables ya presentes en process.env por defecto,
// por lo que NODE_ENV se mantiene en 'test' aunque el .env real diga otra cosa.
dotenv.config();

// Usar una base de datos separada para tests (turnity_test), nunca la de
// desarrollo (turnity).
// Debe ejecutarse antes de que cualquier PrismaClient se
// instancie -- setupFilesAfterEnv corre antes de que Jest cargue el archivo
// de test, asi que el orden queda garantizado.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL no esta definida. Revisa tu .env contra .env.example -- ' +
      'los tests necesitan su propia base de datos (turnity_test), separada de la de desarrollo.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

console.log('✅ Jest setup completado');
