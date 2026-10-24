import { testPrisma } from './database';
import { generateUuid } from '../../src/shared/utils/uuid';

/**
 * Crea un servicio activo con precio, para armar citas que se van a cobrar
 * @description Se crea directo en la base, con su propia categoría. Los nombres
 * no contienen "Test" a propósito: `cleanupTestData` borra los servicios y las
 * categorías con ese texto, y un archivo de tests que corra en paralelo podría
 * dejar la cita sin servicios a mitad de un test. Cada archivo borra los suyos
 * con `deletePricedTestServices`.
 * @param priceInCents - Precio del servicio, en centavos
 * @returns El ID del servicio creado
 */
export async function createPricedTestService(priceInCents: number): Promise<string> {
  const category = await testPrisma.category.create({
    data: { name: `Checkout Fixture Category ${generateUuid()}` },
  });

  const service = await testPrisma.service.create({
    data: {
      name: `Checkout Fixture Service ${generateUuid()}`,
      description: 'Service used to price checkout tests',
      duration: 30,
      price: priceInCents,
      categoryId: category.id,
    },
  });

  return service.id;
}

/**
 * Borra los servicios creados con `createPricedTestService` y sus categorías
 * @description Las asignaciones a estilistas y las relaciones con citas se
 * borran en cascada con el servicio.
 * @param serviceIds - IDs de los servicios a borrar
 */
export async function deletePricedTestServices(serviceIds: string[]): Promise<void> {
  const services = await testPrisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { categoryId: true },
  });

  await testPrisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await testPrisma.category.deleteMany({
    where: { id: { in: services.map((service) => service.categoryId) } },
  });
}
