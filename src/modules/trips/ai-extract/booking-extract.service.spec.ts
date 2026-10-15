import axios from 'axios';
import { BookingExtractService } from './booking-extract.service';

jest.mock('axios');
const post = axios.post as jest.Mock;

const png = { buffer: Buffer.from('fakepng'), mimetype: 'image/png' };
const aiReply = (obj: unknown) => ({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const flight = {
  kind: 'flight', confidence: 0.9, title: 'LCG → BCN',
  flight: { airlineName: 'Vueling', flightNumber: 'VY1291', fromIata: 'LCG', toIata: 'BCN', fromCity: null, toCity: null, depAt: '2026-09-30T23:50', arrAt: '2026-10-01T01:30', bookingRef: 'HMD3JD', seat: null, gate: null },
  transport: {}, accommodation: {}, activity: {}, cost: null, currency: null, notes: null, warnings: [],
};

describe('BookingExtractService', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  let svc: BookingExtractService;
  beforeEach(() => { svc = new BookingExtractService(); post.mockReset(); process.env.OPENAI_API_KEY = 'sk-test'; delete process.env.AI_EXTRACT_DAILY_LIMIT; delete process.env.OPENAI_MODEL; });

  it('envía la imagen como data URL con esquema estricto y devuelve el borrador saneado', async () => {
    post.mockResolvedValue(aiReply(flight));
    const d = await svc.extract(1, { file: png }, undefined, now);
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[1].content[1].image_url.url).toBe(`data:image/png;base64,${Buffer.from('fakepng').toString('base64')}`);
    expect(d.flight.flightNumber).toBe('VY1291');
  });

  it('PDF va como archivo y el modelo es configurable', async () => {
    process.env.OPENAI_MODEL = 'gpt-4o';
    post.mockResolvedValue(aiReply(flight));
    await svc.extract(1, { file: { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf' } }, undefined, now);
    const body = post.mock.calls[0][1];
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[1].content[1].type).toBe('file');
  });

  it('acepta solo texto pegado', async () => {
    post.mockResolvedValue(aiReply(flight));
    await svc.extract(1, { text: 'Reserva HMD3JD LCG-BCN' }, undefined, now);
    expect(post.mock.calls[0][1].messages[1].content[0].text).toContain('HMD3JD');
  });

  it('rechaza sin clave, sin contenido, formato raro o archivo grande', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(svc.extract(1, { file: png }, undefined, now)).rejects.toThrow(/OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(svc.extract(1, {}, undefined, now)).rejects.toThrow(/Sube una imagen/);
    await expect(svc.extract(1, { file: { buffer: Buffer.from('x'), mimetype: 'image/gif' } }, undefined, now)).rejects.toThrow(/Formato no admitido/);
    await expect(svc.extract(1, { file: { buffer: Buffer.alloc(9 * 1024 * 1024), mimetype: 'image/png' } }, undefined, now)).rejects.toThrow(/demasiado grande/);
    expect(post).not.toHaveBeenCalled();
  });

  it('aplica el límite diario por usuario y se reinicia al día siguiente', async () => {
    process.env.AI_EXTRACT_DAILY_LIMIT = '2';
    post.mockResolvedValue(aiReply(flight));
    await svc.extract(1, { file: png }, undefined, now);
    await svc.extract(1, { file: png }, undefined, now);
    await expect(svc.extract(1, { file: png }, undefined, now)).rejects.toThrow(/límite diario/);
    await svc.extract(2, { file: png }, undefined, now); // otro usuario
    await svc.extract(1, { file: png }, undefined, new Date('2026-10-16T10:00:00Z'));
  });

  it('traduce errores de OpenAI sin filtrar la clave y rechaza JSON roto', async () => {
    post.mockRejectedValueOnce({ response: { status: 401 } });
    await expect(svc.extract(1, { file: png }, undefined, now)).rejects.toThrow(/clave de OpenAI/);
    post.mockRejectedValueOnce({ response: { status: 429 } });
    await expect(svc.extract(1, { file: png }, undefined, now)).rejects.toThrow(/saturado|saldo/);
    post.mockRejectedValueOnce(new Error('sk-test boom'));
    await expect(svc.extract(1, { file: png }, undefined, now)).rejects.not.toThrow(/sk-test/);
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'no es json' } }] } });
    await expect(svc.extract(1, { file: png }, undefined, now)).rejects.toThrow(/ilegible/);
  });
});
