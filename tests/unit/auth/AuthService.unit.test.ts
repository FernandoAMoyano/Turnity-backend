import { ChangeUserPassword } from '../../../src/modules/auth/application/use-cases/ChangeUserPassword';
import { UpdateUserProfile } from '../../../src/modules/auth/application/use-cases/UpdateUserProfile';
import { AuthService } from '../../../src/modules/auth/application/services/AuthService';
import { GetUserProfile } from '../../../src/modules/auth/application/use-cases/GetUserProfile';
import { RefreshToken } from '../../../src/modules/auth/application/use-cases/RefreshToken';
import { RegisterUser } from '../../../src/modules/auth/application/use-cases/RegisterUser';
import { LoginUser } from '../../../src/modules/auth/application/use-cases/LoginUser';
import { LoginDto } from '../../../src/modules/auth/application/dto/request/LoginDto';
import { LoginResponseDto } from '../../../src/modules/auth/application/dto/response/LoginResponseDto';
import { generateUuid } from '../../../src/shared/utils/uuid';
import { RegisterDto } from '../../../src/modules/auth/application/dto/request/RegisterDto';
import { UserDto } from '../../../src/modules/auth/application/dto/response/UserDto';
import { UpdateProfileDto } from '../../../src/modules/auth/application/dto/request/UpdateProfileDto';
import { ChangePasswordDto } from '../../../src/modules/auth/application/dto/request/ChangePasswordDto';
describe('AuthService Unit Tests', () => {
  let authService: AuthService;

  let mockLoginUser: jest.Mocked<LoginUser>;
  let mockRegisterUser: jest.Mocked<RegisterUser>;
  let mockRefreshToken: jest.Mocked<RefreshToken>;
  let mockGetUserProfile: jest.Mocked<GetUserProfile>;
  let mockUpdateUserProfile: jest.Mocked<UpdateUserProfile>;
  let mockChangeUserPassword: jest.Mocked<ChangeUserPassword>;

  beforeEach(() => {
    mockLoginUser = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<LoginUser>;

    mockRegisterUser = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RegisterUser>;

    mockRefreshToken = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RefreshToken>;

    mockGetUserProfile = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetUserProfile>;

    mockUpdateUserProfile = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<UpdateUserProfile>;

    mockChangeUserPassword = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ChangeUserPassword>;

    authService = new AuthService(
      mockLoginUser,
      mockRegisterUser,
      mockRefreshToken,
      mockGetUserProfile,
      mockUpdateUserProfile,
      mockChangeUserPassword,
    );
  });

  describe('loginService', () => {
    // Debería delegar al caso de uso LoginUser
    it('should delegate to LoginUser use case', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'TestPass123!',
      };

      const expectedResponse: LoginResponseDto = {
        token: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: generateUuid(),
          name: 'John Doe',
          email: 'test@example.com',
          phone: '+1234567890',
          isActive: true,
          role: {
            id: generateUuid(),
            name: 'CLIENT',
            description: 'Client role',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockLoginUser.execute.mockResolvedValue(expectedResponse);

      const result = await authService.loginService(loginDto);

      expect(mockLoginUser.execute).toHaveBeenCalledWith(loginDto);
      expect(result).toBe(expectedResponse);
      expect(result.token).toBe('access-token');
      expect(result.user.email).toBe('test@example.com');
    });

    // Debería manejar errores de inicio de sesión desde el caso de uso
    it('should handle login errors from use case', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'WrongPassword123!',
      };

      const error = new Error('Invalid credentials');
      mockLoginUser.execute.mockRejectedValue(error);

      await expect(authService.loginService(loginDto)).rejects.toThrow('Invalid credentials');

      expect(mockLoginUser.execute).toHaveBeenCalledWith(loginDto);
    });
  });

  describe('registerService', () => {
    // Debería delegar al caso de uso RegisterUser con rol CLIENT por defecto
    it('should delegate to RegisterUser use case with default CLIENT role', async () => {
      // Usar roleName en lugar de roleId
      const registerDto: RegisterDto = {
        name: 'John Doe',
        email: 'test@example.com',
        phone: '+1234567890',
        password: 'TestPass123!',
        // roleName es opcional - se usará CLIENT por defecto
      };

      const expectedUser: UserDto = {
        id: generateUuid(),
        name: 'John Doe',
        email: 'test@example.com',
        phone: '+1234567890',
        isActive: true,
        role: {
          id: generateUuid(),
          name: 'CLIENT',
          description: 'Client role',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // RegisterUser.execute devuelve { user, verificationToken? }
      mockRegisterUser.execute.mockResolvedValue({ user: expectedUser });

      const result = await authService.registerService(registerDto);

      expect(mockRegisterUser.execute).toHaveBeenCalledWith(registerDto);
      expect(result).toBe(expectedUser);
      expect(result.email).toBe('test@example.com');
      expect(result.name).toBe('John Doe');
    });

    // Test con rol específico
    // Debería delegar al caso de uso RegisterUser con rol especificado
    it('should delegate to RegisterUser use case with specified role', async () => {
      const registerDto: RegisterDto = {
        name: 'Elena Martinez',
        email: 'elena@example.com',
        phone: '+1234567890',
        password: 'TestPass123!',
        roleName: 'STYLIST',
      };

      const expectedUser: UserDto = {
        id: generateUuid(),
        name: 'Elena Martinez',
        email: 'elena@example.com',
        phone: '+1234567890',
        isActive: true,
        role: {
          id: generateUuid(),
          name: 'STYLIST',
          description: 'Stylist role',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRegisterUser.execute.mockResolvedValue({ user: expectedUser });

      const result = await authService.registerService(registerDto);

      expect(mockRegisterUser.execute).toHaveBeenCalledWith(registerDto);
      expect(result).toBe(expectedUser);
      expect(result.email).toBe('elena@example.com');
      expect(result.role.name).toBe('STYLIST');
    });

    // Debería manejar errores de registro desde el caso de uso
    it('should handle registration errors from use case', async () => {
      //
      const registerDto: RegisterDto = {
        name: 'John Doe',
        email: 'existing@example.com',
        phone: '+1234567890',
        password: 'TestPass123!',
        roleName: 'CLIENT',
      };

      const error = new Error('Email already exists');
      mockRegisterUser.execute.mockRejectedValue(error);

      await expect(authService.registerService(registerDto)).rejects.toThrow(
        'Email already exists',
      );

      expect(mockRegisterUser.execute).toHaveBeenCalledWith(registerDto);
    });

    // Test para rol inválido
    // Debería manejar error de rol inválido desde el caso de uso
    it('should handle invalid role error from use case', async () => {
      const registerDto: RegisterDto = {
        name: 'John Doe',
        email: 'test@example.com',
        phone: '+1234567890',
        password: 'TestPass123!',
        roleName: 'INVALID_ROLE',
      };

      const error = new Error(
        'Invalid role: INVALID_ROLE. Valid roles are: CLIENT, STYLIST, ADMIN',
      );
      mockRegisterUser.execute.mockRejectedValue(error);

      await expect(authService.registerService(registerDto)).rejects.toThrow(
        'Invalid role: INVALID_ROLE. Valid roles are: CLIENT, STYLIST, ADMIN',
      );

      expect(mockRegisterUser.execute).toHaveBeenCalledWith(registerDto);
    });
  });

  describe('refreshTokenService', () => {
    // Debería delegar al caso de uso RefreshToken
    it('should delegate to RefreshToken use case', async () => {
      const refreshToken = 'valid-refresh-token';
      const expectedResponse: LoginResponseDto = {
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        user: {
          id: generateUuid(),
          name: 'John Doe',
          email: 'test@example.com',
          phone: '+1234567890',
          isActive: true,
          role: {
            id: generateUuid(),
            name: 'CLIENT',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockRefreshToken.execute.mockResolvedValue(expectedResponse);

      const result = await authService.refreshTokenService(refreshToken);

      expect(mockRefreshToken.execute).toHaveBeenCalledWith(refreshToken);
      expect(result).toBe(expectedResponse);
      expect(result.token).toBe('new-access-token');
    });

    // Debería manejar token de refresco inválido desde el caso de uso
    it('should handle invalid refresh token from use case', async () => {
      const invalidToken = 'invalid-refresh-token';
      const error = new Error('Invalid refresh token');

      mockRefreshToken.execute.mockRejectedValue(error);

      await expect(authService.refreshTokenService(invalidToken)).rejects.toThrow(
        'Invalid refresh token',
      );

      expect(mockRefreshToken.execute).toHaveBeenCalledWith(invalidToken);
    });
  });

  describe('getUserProfileService', () => {
    // Debería delegar al caso de uso GetUserProfile
    it('should delegate to GetUserProfile use case', async () => {
      const userId = generateUuid();
      const expectedUser: UserDto = {
        id: userId,
        name: 'John Doe',
        email: 'test@example.com',
        phone: '+1234567890',
        isActive: true,
        role: {
          id: generateUuid(),
          name: 'CLIENT',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGetUserProfile.execute.mockResolvedValue(expectedUser);

      const result = await authService.getUserProfileService(userId);

      expect(mockGetUserProfile.execute).toHaveBeenCalledWith(userId);
      expect(result).toBe(expectedUser);
      expect(result.id).toBe(userId);
    });

    // Debería manejar usuario no encontrado desde el caso de uso
    it('should handle user not found from use case', async () => {
      const userId = 'non-existent-id';
      const error = new Error('User not found');

      mockGetUserProfile.execute.mockRejectedValue(error);

      await expect(authService.getUserProfileService(userId)).rejects.toThrow('User not found');

      expect(mockGetUserProfile.execute).toHaveBeenCalledWith(userId);
    });
  });

  describe('updateProfileService', () => {
    // Debería delegar al caso de uso UpdateUserProfile
    it('should delegate to UpdateUserProfile use case', async () => {
      const userId = generateUuid();
      const updateDto: UpdateProfileDto = {
        name: 'Jane Doe',
        phone: '+0987654321',
      };

      const expectedUser: UserDto = {
        id: userId,
        name: 'Jane Doe',
        email: 'test@example.com',
        phone: '+0987654321',
        isActive: true,
        role: {
          id: generateUuid(),
          name: 'CLIENT',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUpdateUserProfile.execute.mockResolvedValue(expectedUser);

      const result = await authService.updateProfileService(userId, updateDto);

      expect(mockUpdateUserProfile.execute).toHaveBeenCalledWith(userId, updateDto);
      expect(result).toBe(expectedUser);
      expect(result.name).toBe('Jane Doe');
      expect(result.phone).toBe('+0987654321');
    });
  });

  describe('changePasswordService', () => {
    // Debería delegar al caso de uso ChangeUserPassword
    it('should delegate to ChangeUserPassword use case', async () => {
      const userId = generateUuid();
      const changePasswordDto: ChangePasswordDto = {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
      };

      mockChangeUserPassword.execute.mockResolvedValue();

      await authService.changePasswordService(userId, changePasswordDto);

      expect(mockChangeUserPassword.execute).toHaveBeenCalledWith(userId, changePasswordDto);
    });

    // Debería manejar contraseña actual incorrecta desde el caso de uso
    it('should handle incorrect current password from use case', async () => {
      const userId = generateUuid();
      const changePasswordDto: ChangePasswordDto = {
        currentPassword: 'WrongPass123!',
        newPassword: 'NewPass123!',
      };

      const error = new Error('Current password is incorrect');
      mockChangeUserPassword.execute.mockRejectedValue(error);

      await expect(authService.changePasswordService(userId, changePasswordDto)).rejects.toThrow(
        'Current password is incorrect',
      );

      expect(mockChangeUserPassword.execute).toHaveBeenCalledWith(userId, changePasswordDto);
    });
  });
});
