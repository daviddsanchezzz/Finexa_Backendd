import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_TOKEN_LENGTH = 32;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Protege los endpoints de /integrations/vida con un token propio y de solo lectura.
 *
 * - Está desactivado por defecto: sin `VIDA_INTEGRATION_TOKEN` (o con menos de 32 caracteres) responde 404,
 *   como si la ruta no existiera.
 * - El token solo se acepta en la cabecera `Authorization: Bearer …`; nunca en la URL, para que no acabe en logs.
 * - Se compara en tiempo constante (hash + timingSafeEqual).
 * - No es el JWT del usuario: no sirve para ningún otro endpoint de Finexa.
 */
@Injectable()
export class VidaIntegrationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = (process.env.VIDA_INTEGRATION_TOKEN ?? '').trim();
    if (expected.length < MIN_TOKEN_LENGTH) throw new NotFoundException();

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    const given = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';

    if (!given || !timingSafeEqual(digest(given), digest(expected))) throw new UnauthorizedException();
    return true;
  }
}
