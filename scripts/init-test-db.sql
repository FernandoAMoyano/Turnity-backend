-- Crea la base de datos de tests al inicializar el contenedor de Postgres.
-- La imagen oficial solo crea la base que nombra POSTGRES_DB; cualquier base
-- adicional tiene que salir de un script en /docker-entrypoint-initdb.d/, que
-- el entrypoint ejecuta una unica vez, cuando el volumen de datos esta vacio.
--
-- Sin esto un clon limpio levanta, pero la suite de tests no puede correr:
-- jest.setup.ts apunta DATABASE_URL a TEST_DATABASE_URL y falla si esa base
-- no existe. El nombre tiene que coincidir con el de TEST_DATABASE_URL en .env.
CREATE DATABASE turnity_test;
