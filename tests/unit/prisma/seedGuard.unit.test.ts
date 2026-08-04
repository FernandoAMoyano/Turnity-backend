import { assertSeedIsAllowed } from '../../../prisma/seedGuard';

describe('assertSeedIsAllowed', () => {
  // con NODE_ENV=production
  describe('with NODE_ENV=production', () => {
    // Debería lanzar un error y no dejar continuar el seed
    it('should throw and prevent the seed from continuing', () => {
      expect(() => assertSeedIsAllowed('production')).toThrow(
        /no puede correr con NODE_ENV=production/,
      );
    });
  });

  // con NODE_ENV distinto de production
  describe('with NODE_ENV other than production', () => {
    // Debería no lanzar cuando NODE_ENV es development
    it('should not throw when NODE_ENV is development', () => {
      expect(() => assertSeedIsAllowed('development')).not.toThrow();
    });

    // Debería no lanzar cuando NODE_ENV es test
    it('should not throw when NODE_ENV is test', () => {
      expect(() => assertSeedIsAllowed('test')).not.toThrow();
    });

    // Debería no lanzar cuando NODE_ENV es undefined
    it('should not throw when NODE_ENV is undefined', () => {
      expect(() => assertSeedIsAllowed(undefined)).not.toThrow();
    });
  });
});
