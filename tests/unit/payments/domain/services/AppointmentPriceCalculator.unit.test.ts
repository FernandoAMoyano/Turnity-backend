import { AppointmentPriceCalculator } from '../../../../../src/modules/payments/domain/services/AppointmentPriceCalculator';
import { Service } from '../../../../../src/modules/services/domain/entities/Service';
import { StylistService } from '../../../../../src/modules/services/domain/entities/StylistService';

describe('AppointmentPriceCalculator', () => {
  const categoryId = '123e4567-e89b-12d3-a456-426614174010';
  const stylistId = '123e4567-e89b-12d3-a456-426614174020';

  const haircut = new Service(
    '123e4567-e89b-12d3-a456-426614174001',
    categoryId,
    'Corte',
    'Corte de pelo',
    30,
    0,
    2500,
  );
  const coloring = new Service(
    '123e4567-e89b-12d3-a456-426614174002',
    categoryId,
    'Color',
    'Coloración completa',
    90,
    0,
    6000,
  );

  // Debería sumar los precios base cuando no hay asignaciones del estilista
  it('should add up the base prices when there are no stylist assignments', () => {
    expect(AppointmentPriceCalculator.totalInCents([haircut, coloring], [])).toBe(8500);
  });

  // Debería usar el precio propio del estilista cuando lo tiene
  it('should use the stylist custom price when there is one', () => {
    const assignments = [new StylistService(stylistId, coloring.id, 7000)];

    expect(AppointmentPriceCalculator.totalInCents([haircut, coloring], assignments)).toBe(9500);
  });

  // Debería usar el precio base cuando la asignación no tiene precio propio
  it('should use the base price when the assignment has no custom price', () => {
    const assignments = [new StylistService(stylistId, haircut.id, null)];

    expect(AppointmentPriceCalculator.totalInCents([haircut], assignments)).toBe(2500);
  });

  // Debería usar el precio propio aunque el estilista haya dejado de ofrecer el servicio
  it('should use the custom price even if the stylist no longer offers the service', () => {
    const assignments = [new StylistService(stylistId, haircut.id, 3000, false)];

    expect(AppointmentPriceCalculator.totalInCents([haircut], assignments)).toBe(3000);
  });

  // Debería ignorar las asignaciones de servicios que no están en la cita
  it('should ignore assignments for services that are not in the appointment', () => {
    const assignments = [new StylistService(stylistId, coloring.id, 1000)];

    expect(AppointmentPriceCalculator.totalInCents([haircut], assignments)).toBe(2500);
  });

  // Debería devolver 0 cuando la cita no tiene servicios
  it('should return 0 when the appointment has no services', () => {
    expect(AppointmentPriceCalculator.totalInCents([], [])).toBe(0);
  });
});
