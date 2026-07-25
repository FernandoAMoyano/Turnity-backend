import { renderVerificationEmail } from '../../../../src/shared/email/templates/verifyEmail';
import { renderPasswordResetEmail } from '../../../../src/shared/email/templates/resetPassword';

describe('email templates', () => {
  describe('renderVerificationEmail', () => {
    const ctx = {
      to: 'user@example.com',
      name: 'Maria',
      verificationUrl: 'https://turnity.com/verify-email?token=abc123',
      expiresInHours: 24,
    };

    it('should include subject, the verification url and the TTL in both html and text', () => {
      const { subject, html, text } = renderVerificationEmail(ctx);

      expect(subject).toContain('Turnity');
      expect(text).toContain(ctx.verificationUrl);
      expect(text).toContain('24');
      expect(text).toContain(ctx.name);
      expect(html).toContain(ctx.verificationUrl);
      expect(html).toContain('24');
    });

    it('should escape html-sensitive characters in interpolated values', () => {
      const { html } = renderVerificationEmail({ ...ctx, name: '<script>x</script>' });

      expect(html).not.toContain('<script>x</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('renderPasswordResetEmail', () => {
    const ctx = {
      to: 'user@example.com',
      name: 'Lucia',
      resetUrl: 'https://turnity.com/reset-password?token=xyz789',
      expiresInMinutes: 60,
    };

    it('should include subject, the reset url and the TTL in both html and text', () => {
      const { subject, html, text } = renderPasswordResetEmail(ctx);

      expect(subject).toContain('Turnity');
      expect(text).toContain(ctx.resetUrl);
      expect(text).toContain('60');
      expect(text).toContain(ctx.name);
      expect(html).toContain(ctx.resetUrl);
      expect(html).toContain('60');
    });
  });
});
