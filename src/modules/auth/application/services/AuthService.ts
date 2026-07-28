import { ChangePasswordDto } from '../dto/request/ChangePasswordDto';
import { LoginDto } from '../dto/request/LoginDto';
import { RegisterDto } from '../dto/request/RegisterDto';
import { UpdateProfileDto } from '../dto/request/UpdateProfileDto';
import { LoginResponseDto } from '../dto/response/LoginResponseDto';
import { UserDto } from '../dto/response/UserDto';
import { ChangeUserPassword } from '../use-cases/ChangeUserPassword';
import { GetUserProfile } from '../use-cases/GetUserProfile';
import { LoginUser } from '../use-cases/LoginUser';
import { RefreshToken } from '../use-cases/RefreshToken';
import { RegisterUser } from '../use-cases/RegisterUser';
import { UpdateUserProfile } from '../use-cases/UpdateUserProfile';

export class AuthService {
  constructor(
    private loginUser: LoginUser,
    private registerUser: RegisterUser,
    private refreshToken: RefreshToken,
    private getUserProfile: GetUserProfile,
    private updateUserProfile: UpdateUserProfile,
    private changeUserPassword: ChangeUserPassword,
  ) {}

  async loginService(loginDto: LoginDto): Promise<LoginResponseDto> {
    return this.loginUser.execute(loginDto);
  }

  async registerService(registerDto: RegisterDto): Promise<UserDto> {
    // RegisterUser ahora devuelve { user, verificationToken? }; este servicio
    // (legacy) expone solo el UserDto para no cambiar su contrato.
    const result = await this.registerUser.execute(registerDto);
    return result.user;
  }

  async refreshTokenService(refreshToken: string): Promise<LoginResponseDto> {
    return this.refreshToken.execute(refreshToken);
  }

  async getUserProfileService(userId: string): Promise<UserDto> {
    return this.getUserProfile.execute(userId);
  }

  async updateProfileService(userId: string, updateDto: UpdateProfileDto): Promise<UserDto> {
    return this.updateUserProfile.execute(userId, updateDto);
  }

  async changePasswordService(userId: string, changePasswordDto: ChangePasswordDto): Promise<void> {
    return this.changeUserPassword.execute(userId, changePasswordDto);
  }
}
