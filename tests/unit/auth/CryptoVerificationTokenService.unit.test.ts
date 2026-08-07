import { VerificationTokenType } from '@prisma/client';
import { CryptoVerificationTokenService } from '../../../src/modules/auth/infrastructure/services/CryptoVerificationTokenService';
import {
  IVerificationTokenRepository,
  CreateVerificationTokenData,
} from '../../../src/modules/auth/domain/repositories/IVerificationTokenRepository';
import { VerificationToken } from '../../../src/modules/auth/domain/entities/VerificationToken';
import { InvalidTokenError } from '../../../src/shared/exceptions/InvalidTokenError';
import { hashToken } from '../../../src/shared/crypto/opaqueToken';

/** Repo fake en memoria que respeta el contrato IVerificationTokenRepository */
class FakeVerificationTokenRepository implements IVerificationTokenRepository {
  public rows: VerificationToken[] = [];
  private seq = 0;

  async create(data: CreateVerificationTokenData): Promise<VerificationToken> {
    const row = new VerificationToken(
      data.id ?? `id-${++this.seq}`,
      data.userId,
      data.type,
      data.tokenHash,
      data.expiresAt,
      null,
      data.ipAddress ?? null,
      data.userAgent ?? null,
      new Date(),
    );
    this.rows.push(row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<VerificationToken | null> {
    return this.rows.find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async consume(id: string): Promise<void> {
    this.rows = this.rows.map((r) =>
      r.id === id && r.consumedAt === null ? this.withConsumedAt(r, new Date()) : r,
    );
  }

  async invalidateActiveByUser(userId: string, type: VerificationTokenType): Promise<number> {
    let count = 0;
    this.rows = this.rows.map((r) => {
      if (r.userId === userId && r.type === type && r.consumedAt === null) {
        count++;
        return this.withConsumedAt(r, new Date());
      }
      return r;
    });
    return count;
  }

  async deleteExpired(now: Date): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.expiresAt.getTime() >= now.getTime());
    return before - this.rows.length;
  }

  /** Helper de test para insertar un token ya armado (ej. uno expirado) */
  seed(row: VerificationToken): void {
    this.rows.push(row);
  }

  private withConsumedAt(r: VerificationToken, consumedAt: Date): VerificationToken {
    return new VerificationToken(
      r.id,
      r.userId,
      r.type,
      r.tokenHash,
      r.expiresAt,
      consumedAt,
      r.ipAddress,
      r.userAgent,
      r.createdAt,
    );
  }
}

describe('CryptoVerificationTokenService', () => {
  let repo: FakeVerificationTokenRepository;
  let service: CryptoVerificationTokenService;

  beforeEach(() => {
    repo = new FakeVerificationTokenRepository();
    service = new CryptoVerificationTokenService(repo);
  });

  describe('issue', () => {
    // Debería devolver un token opaco y persistir solo su hash, con expiración futura
    it('should return an opaque token and persist only its hash, with a future expiry', async () => {
      const { token, expiresAt } = await service.issue('user-1', VerificationTokenType.EMAIL_VERIFICATION);

      expect(typeof token).toBe('string');
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(repo.rows).toHaveLength(1);
      // se persiste el hash, nunca el token en claro
      expect(repo.rows[0].tokenHash).toBe(hashToken(token));
      expect(repo.rows[0].tokenHash).not.toBe(token);
    });

    // Debería invalidar los tokens activos previos del mismo (user, type)
    it('should invalidate previous active tokens of the same (user, type)', async () => {
      const first = await service.issue('user-1', VerificationTokenType.EMAIL_VERIFICATION);
      await service.issue('user-1', VerificationTokenType.EMAIL_VERIFICATION);

      // el primero quedo consumido/invalidado
      const firstRow = repo.rows.find((r) => r.tokenHash === hashToken(first.token));
      expect(firstRow?.isConsumed()).toBe(true);
      // el primer token ya no sirve para verificar
      await expect(
        service.verifyAndConsume(first.token, VerificationTokenType.EMAIL_VERIFICATION),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });
  });

  describe('verifyAndConsume', () => {
    // Debería devolver el userId y consumir el token cuando es válido
    it('should return the userId and consume the token when valid', async () => {
      const { token } = await service.issue('user-42', VerificationTokenType.EMAIL_VERIFICATION);

      const userId = await service.verifyAndConsume(token, VerificationTokenType.EMAIL_VERIFICATION);

      expect(userId).toBe('user-42');
      // single-use: un segundo intento falla
      await expect(
        service.verifyAndConsume(token, VerificationTokenType.EMAIL_VERIFICATION),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    // Debería rechazar un token de otro tipo
    it('should reject a token of a different type', async () => {
      const { token } = await service.issue('user-1', VerificationTokenType.EMAIL_VERIFICATION);

      await expect(
        service.verifyAndConsume(token, VerificationTokenType.PASSWORD_RESET),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    // Debería rechazar un token inexistente
    it('should reject a non-existent token', async () => {
      await expect(
        service.verifyAndConsume('does-not-exist', VerificationTokenType.EMAIL_VERIFICATION),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    // Debería rechazar un token expirado
    it('should reject an expired token', async () => {
      const raw = 'expired-raw-token';
      repo.seed(
        new VerificationToken(
          'id-exp',
          'user-1',
          VerificationTokenType.EMAIL_VERIFICATION,
          hashToken(raw),
          new Date(Date.now() - 1000),
          null,
          null,
          null,
          new Date(),
        ),
      );

      await expect(
        service.verifyAndConsume(raw, VerificationTokenType.EMAIL_VERIFICATION),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });
  });
});
