import { parseFtFundPage } from './ft-fund-price.service';

const page = (opts: { title?: string; price?: string; ccy?: string; asOf?: string } = {}) => `
<html><head><title>${opts.title ?? 'Vanguard Emerging Markets Stock Index Fund EUR Acc, IE0031786696:EUR summary - FT.com'}</title></head>
<body><ul class="mod-tearsheet-overview__quote__bar"><li>
<span class="mod-ui-data-list__label">Price (${opts.ccy ?? 'EUR'})</span><span class="mod-ui-data-list__value">${opts.price ?? '312.76'}</span></li></ul>
<div class="mod-disclaimer">Data delayed at least 15 minutes, as of ${opts.asOf ?? 'Oct 13 2026'}.</div>
<footer><div class="mod-disclaimer">Data delayed at least 15 minutes, as of Oct 14 2026 09:08 BST.</div></footer>
</body></html>`;

describe('parseFtFundPage', () => {
  it('lee precio y la fecha del NAV (no la del pie de página)', () => {
    const r = parseFtFundPage(page(), 'IE0031786696', 'EUR');
    expect(r.price).toBe(312.76);
    expect(r.navDate.toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('acepta separador de miles', () => {
    expect(parseFtFundPage(page({ price: '1,234.56' }), 'IE0031786696', 'EUR').price).toBe(1234.56);
  });

  it('falla si la página es de otro fondo', () => {
    expect(() => parseFtFundPage(page(), 'IE00BYX5NX33', 'EUR')).toThrow(/not IE00BYX5NX33:EUR/);
  });

  it('falla si la divisa del precio no es la pedida', () => {
    expect(() => parseFtFundPage(page({ ccy: 'GBP' }), 'IE0031786696', 'EUR')).toThrow(/currency/);
  });

  it('falla si no hay precio', () => {
    expect(() => parseFtFundPage('<title>x IE0031786696:EUR y</title>', 'IE0031786696', 'EUR')).toThrow(/price not found/);
  });

  it('falla si el precio es 0', () => {
    expect(() => parseFtFundPage(page({ price: '0.00' }), 'IE0031786696', 'EUR')).toThrow(/invalid/);
  });

  it('falla si no hay fecha', () => {
    const html = page().replace(/as of/g, 'sometime');
    expect(() => parseFtFundPage(html, 'IE0031786696', 'EUR')).toThrow(/date not found/);
  });
});
