import { PaymentStatusEnum } from '../../../../../src/modules/payments/domain/entities/Payment';
import { PaymentStatusMapper } from '../../../../../src/modules/payments/domain/services/PaymentStatusMapper';

describe('PaymentStatusMapper', () => {
  describe('toInternalStatus - tabla de mapeo (§2.5 del plan)', () => {
    const cases: Array<[string, PaymentStatusEnum]> = [
      ['approved', PaymentStatusEnum.COMPLETED],
      ['authorized', PaymentStatusEnum.PENDING],
      ['pending', PaymentStatusEnum.PENDING],
      ['in_process', PaymentStatusEnum.PENDING],
      ['in_mediation', PaymentStatusEnum.PENDING],
      ['rejected', PaymentStatusEnum.FAILED],
      ['cancelled', PaymentStatusEnum.FAILED],
      ['refunded', PaymentStatusEnum.REFUNDED],
      ['charged_back', PaymentStatusEnum.REFUNDED],
    ];

    it.each(cases)('should map "%s" to %s', (rawStatus, expected) => {
      expect(PaymentStatusMapper.toInternalStatus(rawStatus)).toBe(expected);
    });
  });

  describe('toInternalStatus - estados no reconocidos', () => {
    // Debería tratar un estado desconocido como PENDING sin lanzar
    it('should treat an unknown status as PENDING without throwing', () => {
      expect(() => PaymentStatusMapper.toInternalStatus('some_future_mp_status')).not.toThrow();
      expect(PaymentStatusMapper.toInternalStatus('some_future_mp_status')).toBe(
        PaymentStatusEnum.PENDING,
      );
    });

    // Debería tratar un string vacío como no reconocido
    it('should treat an empty string as unknown', () => {
      expect(PaymentStatusMapper.toInternalStatus('')).toBe(PaymentStatusEnum.PENDING);
    });
  });
});
