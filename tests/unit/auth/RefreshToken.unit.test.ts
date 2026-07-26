import { RoleName } from '@prisma/client';
import { RefreshToken } from '../../../src/modules/auth/application/use-cases/RefreshToken';
import { JwtService } from '../../../src/modules/auth/application/services/JwtService';
import { RefreshTokenService } from '../../../src/modules/auth/application/services/RefreshTokenService';
import { IUserRepository } from '../../../src/modules/auth/domain/repositories/IUserRepository';
import { IRoleRepository } from '../../../src/modules/auth/domain/repositories/IRoleRepository';
import { IRefreshTokenRepository } from '../../../src/modules/auth/domain/repositories/IRefreshTokenRepository';
import { RefreshTokenSession } from '../../../src/modules/auth/domain/entities/RefreshTokenSession';
import { User } from '../../../src/modules/auth/domain/entities/User';
import { Role } from '../../../src/modules/auth/domain/entities/Role';
import { UnauthorizedError } from '../../../src/shared/exceptions/UnauthorizedError';
import { NotFoundError } from '../../../src/shared/exceptions/NotFoundError';

describe('RefreshToken Use Case (rotacion + reuse detection)', () => {
  let refreshToken: RefreshToken;
  let mockUserRepository: jest.Mocked<IUserRepository>;
  let mockRoleRepository: jest.Mocked<IRoleRepository>;
  let mockJwtService: jest.Mocked<JwtService>;
  let mockRefreshTokenRepository: jest.Mocked<IRefreshTokenRepository>;
  let mockRefreshTokenService: jest.Mocked<RefreshTokenService>;

  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  const activeUser = new User(
    'user-id',
    'role-id',
    'Test User',
    'test@example.com',
    '+1234567890',
    'hashed-password',
    true,
  );

  const clientRole = Role.fromPersistence('role-id', RoleName.CLIENT, 'Cliente');

  // Sesion vigente (no revocada, no expirada) para el hash 'hash-1'
  const activeSession = () =>
    new RefreshTokenSession('sess-id', 'fam-id', 'user-id', 'hash-1', future, null, null, null, null, past);

  beforeEach(() => {
    mockUserRepository = {
      findById: jest.fn(),
      findByIdWithRole: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailWithRole: jest.fn(),
      existsByEmail: jest.fn(),
      markEmailAsVerified: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findAll: jest.fn(),
      findByRole: jest.fn(),
    };

    mockRoleRepository = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockJwtService = {
      generateAccessToken: jest.fn(),
      generateRefreshToken: jest.fn(),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
    };

    mockRefreshTokenRepository = {
      create: jest.fn(),
      findByTokenHash: jest.fn(),
      rotate: jest.fn(),
      revokeById: jest.fn(),
      revokeFamily: jest.fn(),
      revokeAllForUser: jest.fn(),
      deleteExpired: jest.fn(),
    };

    mockRefreshTokenService = {
      generate: jest.fn(),
      hash: jest.fn(),
    };

    refreshToken = new RefreshToken(
      mockUserRepository,
      mockRoleRepository,
      mockJwtService,
      mockRefreshTokenRepository,
      mockRefreshTokenService,
    );
  });

  // Debería rotar y renovar los tokens con una sesión válida
  it('should rotate and refresh tokens successfully with a valid session', async () => {
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(activeSession());
    mockUserRepository.findById.mockResolvedValue(activeUser);
    mockRoleRepository.findById.mockResolvedValue(clientRole);
    mockJwtService.generateAccessToken.mockReturnValue('new-access-token');
    mockRefreshTokenService.generate.mockReturnValue({
      token: 'new-refresh',
      hash: 'new-hash',
      expiresAt: future,
    });
    mockRefreshTokenRepository.rotate.mockResolvedValue(
      new RefreshTokenSession('sess-2', 'fam-id', 'user-id', 'new-hash', future, null, null, null, null, new Date()),
    );

    const result = await refreshToken.execute('opaque-refresh');

    expect(result.token).toBe('new-access-token');
    expect(result.refreshToken).toBe('new-refresh');
    expect(result.user.id).toBe(activeUser.id);
    expect(mockRefreshTokenRepository.rotate).toHaveBeenCalledTimes(1);
  });

  // Debería lanzar UnauthorizedError si no existe una sesión para ese token
  it('should throw UnauthorizedError when no session matches the token', async () => {
    mockRefreshTokenService.hash.mockReturnValue('unknown-hash');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(null);

    await expect(refreshToken.execute('bad-token')).rejects.toThrow(UnauthorizedError);
  });

  // Reuse: sesión ya revocada -> revoca toda la familia y rechaza (RFC 9700)
  it('should revoke the whole family and reject when a rotated token is reused', async () => {
    const revoked = new RefreshTokenSession(
      'sess-id', 'fam-9', 'user-id', 'hash-1', future, new Date(), 'sess-next', null, null, past,
    );
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(revoked);

    await expect(refreshToken.execute('reused-token')).rejects.toThrow(UnauthorizedError);
    expect(mockRefreshTokenRepository.revokeFamily).toHaveBeenCalledWith('fam-9');
    expect(mockRefreshTokenRepository.rotate).not.toHaveBeenCalled();
  });

  // Debería lanzar UnauthorizedError si la sesión está expirada
  it('should throw UnauthorizedError when the session is expired', async () => {
    const expired = new RefreshTokenSession(
      'sess-id', 'fam-id', 'user-id', 'hash-1', past, null, null, null, null, past,
    );
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(expired);

    await expect(refreshToken.execute('expired-token')).rejects.toThrow(UnauthorizedError);
  });

  // Usuario inactivo -> revoca la sesión y rechaza
  it('should revoke the session and reject when the user is inactive', async () => {
    const inactiveUser = new User(
      'user-id', 'role-id', 'Test User', 'test@example.com', '+1234567890', 'hashed-password', false,
    );
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(activeSession());
    mockUserRepository.findById.mockResolvedValue(inactiveUser);

    await expect(refreshToken.execute('token')).rejects.toThrow(UnauthorizedError);
    expect(mockRefreshTokenRepository.revokeById).toHaveBeenCalledWith('sess-id');
  });

  // Usuario inexistente -> UnauthorizedError
  it('should throw UnauthorizedError when the user does not exist', async () => {
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(activeSession());
    mockUserRepository.findById.mockResolvedValue(null);

    await expect(refreshToken.execute('token')).rejects.toThrow(UnauthorizedError);
  });

  // Rol inexistente -> NotFoundError
  it('should propagate NotFoundError when the role is missing', async () => {
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(activeSession());
    mockUserRepository.findById.mockResolvedValue(activeUser);
    mockRoleRepository.findById.mockResolvedValue(null);

    await expect(refreshToken.execute('token')).rejects.toThrow(NotFoundError);
  });

  // Errores de base de datos no se convierten en 401
  it('should not convert database errors into 401', async () => {
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockRejectedValue(new Error('db down'));

    let caughtError: unknown;
    try {
      await refreshToken.execute('token');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).not.toBeInstanceOf(UnauthorizedError);
    expect((caughtError as Error).message).toBe('db down');
  });

  // Carrera perdida en rotate (devuelve null) -> UnauthorizedError
  it('should throw UnauthorizedError when rotate loses a concurrency race', async () => {
    mockRefreshTokenService.hash.mockReturnValue('hash-1');
    mockRefreshTokenRepository.findByTokenHash.mockResolvedValue(activeSession());
    mockUserRepository.findById.mockResolvedValue(activeUser);
    mockRoleRepository.findById.mockResolvedValue(clientRole);
    mockJwtService.generateAccessToken.mockReturnValue('acc');
    mockRefreshTokenService.generate.mockReturnValue({ token: 't', hash: 'h', expiresAt: future });
    mockRefreshTokenRepository.rotate.mockResolvedValue(null);

    await expect(refreshToken.execute('token')).rejects.toThrow(UnauthorizedError);
  });
});
