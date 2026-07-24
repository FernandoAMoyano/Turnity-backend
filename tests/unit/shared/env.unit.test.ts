import { validateEnv } from '../../../src/shared/config/env';

describe('validateEnv', () => {
  const validEnv = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/turnity?schema=public',
  };

  let exitSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // con variables válidas
  describe('with valid variables', () => {
    // Debería parsear correctamente sin llamar a process.exit
    it('should parse correctly without calling process.exit', () => {
      const result = validateEnv(validEnv);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(result.JWT_ACCESS_SECRET).toBe(validEnv.JWT_ACCESS_SECRET);
      expect(result.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    });

    // Debería aplicar los defaults de las variables opcionales
    it('should apply defaults for optional variables', () => {
      const result = validateEnv(validEnv);

      expect(result.NODE_ENV).toBe('development');
      expect(result.PORT).toBe(3000);
      expect(result.LOG_LEVEL).toBe('info');
      expect(result.JWT_ACCESS_EXPIRY).toBe('15m');
      expect(result.JWT_REFRESH_EXPIRY).toBe('7d');
      expect(result.FRONTEND_URL).toBe('http://localhost:3000');
    });

    // Debería respetar los valores explícitos de las variables opcionales en vez del default
    it('should respect explicit values for optional variables instead of the default', () => {
      const result = validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        PORT: '8080',
        LOG_LEVEL: 'debug',
        JWT_ACCESS_EXPIRY: '1h',
        FRONTEND_URL: 'https://turnity.com',
        // MAIL_* son obligatorias cuando NODE_ENV=production (superRefine)
        MAIL_HOST: 'smtp.turnity.com',
        MAIL_USER: 'noreply@turnity.com',
        MAIL_PASSWORD: 'secret',
        MAIL_FROM: 'noreply@turnity.com',
      });

      expect(result.NODE_ENV).toBe('production');
      expect(result.PORT).toBe(8080);
      expect(result.LOG_LEVEL).toBe('debug');
      expect(result.JWT_ACCESS_EXPIRY).toBe('1h');
      expect(result.FRONTEND_URL).toBe('https://turnity.com');
    });
  });

  // con variables requeridas faltantes o inválidas
  describe('with missing or invalid required variables', () => {
    // Debería llamar a process.exit(1) si faltan las MAIL_* en produccion
    it('should call process.exit(1) if MAIL_* are missing in production', () => {
      validateEnv({ ...validEnv, NODE_ENV: 'production' });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería llamar a process.exit(1) si EXPOSE_VERIFICATION_TOKENS es true en produccion
    it('should call process.exit(1) if EXPOSE_VERIFICATION_TOKENS is true in production', () => {
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        MAIL_HOST: 'smtp.turnity.com',
        MAIL_USER: 'noreply@turnity.com',
        MAIL_PASSWORD: 'secret',
        MAIL_FROM: 'noreply@turnity.com',
        EXPOSE_VERIFICATION_TOKENS: 'true',
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería llamar a process.exit(1) si falta JWT_ACCESS_SECRET
    it('should call process.exit(1) if JWT_ACCESS_SECRET is missing', () => {
      const { JWT_ACCESS_SECRET, ...rest } = validEnv;
      void JWT_ACCESS_SECRET;

      validateEnv(rest);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    // Debería llamar a process.exit(1) si JWT_ACCESS_SECRET tiene menos de 32 caracteres
    it('should call process.exit(1) if JWT_ACCESS_SECRET has fewer than 32 characters', () => {
      validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'demasiado-corto' });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería llamar a process.exit(1) si falta DATABASE_URL
    it('should call process.exit(1) if DATABASE_URL is missing', () => {
      const { DATABASE_URL, ...rest } = validEnv;
      void DATABASE_URL;

      validateEnv(rest);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería llamar a process.exit(1) si DATABASE_URL no es una URL válida
    it('should call process.exit(1) if DATABASE_URL is not a valid URL', () => {
      validateEnv({ ...validEnv, DATABASE_URL: 'no-es-una-url' });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería llamar a process.exit(1) si NODE_ENV tiene un valor fuera del enum
    it('should call process.exit(1) if NODE_ENV has a value outside the enum', () => {
      validateEnv({ ...validEnv, NODE_ENV: 'staging' });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería llamar a process.exit(1) si PORT no es un número de puerto válido
    it('should call process.exit(1) if PORT is not a valid port number', () => {
      validateEnv({ ...validEnv, PORT: 'not-a-number' });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería llamar a process.exit(1) si JWT_ACCESS_EXPIRY no matchea el formato esperado
    it('should call process.exit(1) if JWT_ACCESS_EXPIRY does not match the expected format', () => {
      validateEnv({ ...validEnv, JWT_ACCESS_EXPIRY: '2 days' });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // Debería imprimir un mensaje legible por cada variable inválida
    it('should print a readable message for each invalid variable', () => {
      validateEnv({});

      const printedMessages = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(printedMessages).toContain('JWT_ACCESS_SECRET');
      expect(printedMessages).toContain('JWT_REFRESH_SECRET');
      expect(printedMessages).toContain('DATABASE_URL');
    });
  });
});
