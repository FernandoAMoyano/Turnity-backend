import { createEmailTransport, isRealTransport } from '../../../../src/shared/email/transportFactory';

// NODE_ENV=test se fuerza en tests/setup/jest.setup.ts, asi que el factory
// debe devolver siempre el transporte mock (jsonTransport), que NO envia mails.
describe('createEmailTransport (NODE_ENV=test)', () => {
  it('should return a jsonTransport that does not send real emails', async () => {
    const transport = createEmailTransport();

    // El transporte subyacente de nodemailer para jsonTransport se identifica asi
    expect((transport as unknown as { transporter: { name: string } }).transporter.name).toBe(
      'JSONTransport',
    );

    const info = await transport.sendMail({
      from: 'no-reply@turnity.local',
      to: 'user@example.com',
      subject: 'Hola',
      text: 'cuerpo de prueba',
    });

    // jsonTransport serializa el mensaje en vez de entregarlo
    expect(typeof (info as unknown as { message: string }).message).toBe('string');
    expect((info as unknown as { message: string }).message).toContain('cuerpo de prueba');
  });

  it('isRealTransport should be false in test', () => {
    expect(isRealTransport()).toBe(false);
  });
});
