import { Transporter } from 'nodemailer';
import { NodemailerEmailService } from '../../../../src/shared/email/NodemailerEmailService';

describe('NodemailerEmailService', () => {
  const makeTransport = () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
    const transport = { sendMail } as unknown as Transporter;
    return { transport, sendMail };
  };

  it('should send the verification email through the injected transport', async () => {
    const { transport, sendMail } = makeTransport();
    const service = new NodemailerEmailService(transport);

    await service.sendVerificationEmail({
      to: 'user@example.com',
      name: 'Maria',
      verificationUrl: 'https://turnity.com/verify-email?token=abc',
      expiresInHours: 24,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Verifica'),
        html: expect.stringContaining('token=abc'),
        text: expect.stringContaining('token=abc'),
        from: expect.any(String),
      }),
    );
  });

  it('should send the password reset email through the injected transport', async () => {
    const { transport, sendMail } = makeTransport();
    const service = new NodemailerEmailService(transport);

    await service.sendPasswordResetEmail({
      to: 'user@example.com',
      name: 'Lucia',
      resetUrl: 'https://turnity.com/reset-password?token=xyz',
      expiresInMinutes: 60,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Recupera'),
        html: expect.stringContaining('token=xyz'),
        text: expect.stringContaining('token=xyz'),
      }),
    );
  });

  it('should propagate transport errors (caller decides how to handle them)', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('smtp down'));
    const transport = { sendMail } as unknown as Transporter;
    const service = new NodemailerEmailService(transport);

    await expect(
      service.sendVerificationEmail({
        to: 'user@example.com',
        name: 'Maria',
        verificationUrl: 'https://turnity.com/verify-email?token=abc',
        expiresInHours: 24,
      }),
    ).rejects.toThrow('smtp down');
  });
});
