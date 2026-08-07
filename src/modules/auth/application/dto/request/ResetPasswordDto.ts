/**
 * DTO para aplicar el reset: el token opaco del enlace + la nueva password.
 */
export interface ResetPasswordDto {
  token: string;
  password: string;
}
