import { checkDatabaseReadiness } from '../../../../src/shared/health/ReadinessService';

describe('checkDatabaseReadiness', () => {
  // cuando la base de datos responde
  describe('when the database responds', () => {
    // Debería devolver true
    it('should return true', async () => {
      const mockPrisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

      const result = await checkDatabaseReadiness(mockPrisma as never);

      expect(result).toBe(true);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // cuando la base de datos no responde
  describe('when the database does not respond', () => {
    // Debería devolver false en vez de propagar el error
    it('should return false instead of throwing', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
      };

      const result = await checkDatabaseReadiness(mockPrisma as never);

      expect(result).toBe(false);
    });
  });
});
