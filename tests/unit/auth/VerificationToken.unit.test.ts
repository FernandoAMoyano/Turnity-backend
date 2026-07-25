import { VerificationTokenType } from '@prisma/client';
import { VerificationToken } from '../../../src/modules/auth/domain/entities/VerificationToken';

/**
 * Tests de la entidad de dominio VerificationToken.
 *
 * La entidad no toca la base ni la cripto: solo encapsula las reglas de estado
 * del token (expiracion, consumo y usabilidad). Por eso alcanza con construirla
 * a mano y ejercitar sus metodos, sin mocks ni repositorio.
 */

/**
 * Helper para construir una entidad valida por default (activa y sin expirar),
 * permitiendo sobreescribir solo `expiresAt`/`consumedAt`, que son los campos
 * que gobiernan el estado que queremos probar.
 */
const make = (overrides: { expiresAt?: Date; consumedAt?: Date | null } = {}) =>
  new VerificationToken(
    'id-1',
    'user-1',
    VerificationTokenType.EMAIL_VERIFICATION,
    'hash',
    // Por default expira en 60s (futuro) para que el token nazca utilizable
    overrides.expiresAt ?? new Date(Date.now() + 60_000),
    overrides.consumedAt ?? null,
    null,
    null,
    new Date(),
  );

describe('VerificationToken entity', () => {
  // isExpired debería ser true cuando expiresAt está en el pasado
  it('isExpired should be true when expiresAt is in the past', () => {
    expect(make({ expiresAt: new Date(Date.now() - 1000) }).isExpired()).toBe(true);
  });

  // isExpired debería ser false cuando expiresAt está en el futuro
  it('isExpired should be false when expiresAt is in the future', () => {
    expect(make({ expiresAt: new Date(Date.now() + 60_000) }).isExpired()).toBe(false);
  });

  // isConsumed debería reflejar consumedAt: null = activo, fecha = consumido
  it('isConsumed should reflect consumedAt', () => {
    expect(make({ consumedAt: null }).isConsumed()).toBe(false);
    expect(make({ consumedAt: new Date() }).isConsumed()).toBe(true);
  });

  // isUsable debería ser true solo cuando no fue consumido ni expiró
  it('isUsable should be true only when neither consumed nor expired', () => {
    // Caso feliz: activo y vigente
    expect(make().isUsable()).toBe(true);
    // Consumido -> no usable, aunque no haya expirado
    expect(make({ consumedAt: new Date() }).isUsable()).toBe(false);
    // Expirado -> no usable, aunque no haya sido consumido
    expect(make({ expiresAt: new Date(Date.now() - 1000) }).isUsable()).toBe(false);
  });
});
