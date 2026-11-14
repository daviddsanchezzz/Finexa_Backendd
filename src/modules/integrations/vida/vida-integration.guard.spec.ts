import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { VidaIntegrationGuard } from './vida-integration.guard';

const TOKEN = 'a'.repeat(40);
const ctx = (authorization?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }) }) as unknown as ExecutionContext;

describe('VidaIntegrationGuard', () => {
  const guard = new VidaIntegrationGuard();
  const original = process.env.VIDA_INTEGRATION_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.VIDA_INTEGRATION_TOKEN;
    else process.env.VIDA_INTEGRATION_TOKEN = original;
  });

  it('responde 404 si la integración no está configurada', () => {
    delete process.env.VIDA_INTEGRATION_TOKEN;
    expect(() => guard.canActivate(ctx(`Bearer ${TOKEN}`))).toThrow(NotFoundException);
  });

  it('responde 404 si el token configurado es demasiado corto', () => {
    process.env.VIDA_INTEGRATION_TOKEN = 'corto';
    expect(() => guard.canActivate(ctx('Bearer corto'))).toThrow(NotFoundException);
  });

  it('rechaza peticiones sin cabecera, con esquema distinto o con token incorrecto', () => {
    process.env.VIDA_INTEGRATION_TOKEN = TOKEN;
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx(`Basic ${TOKEN}`))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx(`Bearer ${'b'.repeat(40)}`))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx('Bearer '))).toThrow(UnauthorizedException);
  });

  it('acepta el token correcto', () => {
    process.env.VIDA_INTEGRATION_TOKEN = TOKEN;
    expect(guard.canActivate(ctx(`Bearer ${TOKEN}`))).toBe(true);
  });
});
