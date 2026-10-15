import { BadGatewayException, BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { BookingDraft, DRAFT_JSON_SCHEMA, TripContext, buildSystemPrompt, sanitizeDraft } from './booking-draft';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 12_000;

export interface ExtractInput {
  file?: { buffer: Buffer; mimetype: string; originalname?: string };
  text?: string;
}

@Injectable()
export class BookingExtractService {
  private readonly logger = new Logger(BookingExtractService.name);
  private readonly usage = new Map<number, { day: string; n: number }>();

  /** Peticiones por usuario y día: acota el gasto de la API aunque se abuse. */
  private checkQuota(userId: number, now: Date) {
    const limit = parseInt(process.env.AI_EXTRACT_DAILY_LIMIT || '20', 10) || 20;
    const day = now.toISOString().slice(0, 10);
    const u = this.usage.get(userId);
    const cur = u && u.day === day ? u : { day, n: 0 };
    if (cur.n >= limit) throw new HttpException(`Has alcanzado el límite diario (${limit}) de lecturas con IA`, HttpStatus.TOO_MANY_REQUESTS);
    cur.n += 1;
    this.usage.set(userId, cur);
  }

  buildRequest(input: ExtractInput, trip: TripContext | undefined, now: Date) {
    const userContent: any[] = [];
    const text = (input.text || '').trim().slice(0, MAX_TEXT);
    userContent.push({ type: 'text', text: text ? `Texto del documento:\n"""\n${text}\n"""` : 'Extrae los datos de la reserva del archivo adjunto.' });
    if (input.file) {
      const b64 = input.file.buffer.toString('base64');
      if (input.file.mimetype === 'application/pdf') {
        userContent.push({ type: 'file', file: { filename: 'reserva.pdf', file_data: `data:application/pdf;base64,${b64}` } });
      } else {
        userContent.push({ type: 'image_url', image_url: { url: `data:${input.file.mimetype};base64,${b64}`, detail: 'high' } });
      }
    }
    return {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: 'json_schema', json_schema: { name: 'booking_draft', strict: true, schema: DRAFT_JSON_SCHEMA } },
      messages: [
        { role: 'system', content: buildSystemPrompt(now.toISOString().slice(0, 10), trip) },
        { role: 'user', content: userContent },
      ],
    };
  }

  async extract(userId: number, input: ExtractInput, trip?: TripContext, now: Date = new Date()): Promise<BookingDraft> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new ServiceUnavailableException('La lectura con IA no está configurada (falta OPENAI_API_KEY)');
    if (!input.file && !(input.text || '').trim()) throw new BadRequestException('Sube una imagen/PDF o pega el texto de la reserva');
    if (input.file) {
      if (!ALLOWED_MIME.includes(input.file.mimetype)) throw new BadRequestException('Formato no admitido (usa JPG, PNG, WEBP o PDF)');
      if (input.file.buffer.length > MAX_FILE_BYTES) throw new BadRequestException('El archivo es demasiado grande (máx. 8 MB)');
    }
    this.checkQuota(userId, now);

    let content: string | undefined;
    try {
      const res = await axios.post(OPENAI_URL, this.buildRequest(input, trip, now), {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 60_000,
        maxBodyLength: 20 * 1024 * 1024,
      });
      content = res.data?.choices?.[0]?.message?.content;
    } catch (e: any) {
      // Nunca se registra el contenido del documento ni la clave: solo el estado HTTP.
      const status = e?.response?.status;
      this.logger.warn(`OpenAI falló (${status ?? e?.code ?? 'sin respuesta'})`);
      if (status === 429) throw new BadGatewayException('OpenAI está saturado o sin saldo; inténtalo de nuevo más tarde');
      if (status === 401) throw new ServiceUnavailableException('La clave de OpenAI no es válida');
      throw new BadGatewayException('No se pudo leer el documento con IA');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content ?? '');
    } catch {
      throw new BadGatewayException('La IA devolvió una respuesta ilegible; inténtalo de nuevo');
    }
    return sanitizeDraft(parsed, trip);
  }
}
