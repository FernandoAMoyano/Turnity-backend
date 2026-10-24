import { Service } from '../../../services/domain/entities/Service';
import { StylistService } from '../../../services/domain/entities/StylistService';

/**
 * Servicio de dominio que calcula lo que se cobra por una cita
 * @description El monto sale de los servicios incluidos en la cita, nunca de
 * un valor que mande quien paga. Cada servicio se cobra al precio que tiene
 * configurado el estilista de la cita, si lo tiene, y si no al precio base del
 * servicio. Se usa la asignación del estilista aunque hoy haya dejado de
 * ofrecer el servicio: la cita ya se reservó con él.
 */
export class AppointmentPriceCalculator {
  /**
   * Calcula el total de la cita
   * @param services - Servicios incluidos en la cita
   * @param stylistAssignments - Asignaciones del estilista de la cita a esos
   * servicios. Vacío si la cita no tiene estilista o si no hay asignaciones.
   * @returns El total en centavos, la misma unidad en que se guardan los precios
   */
  static totalInCents(services: Service[], stylistAssignments: StylistService[]): number {
    return services.reduce((total, service) => {
      const assignment = stylistAssignments.find((item) => item.serviceId === service.id);
      const price = assignment ? assignment.getEffectivePrice(service.price) : service.price;
      return total + price;
    }, 0);
  }
}
