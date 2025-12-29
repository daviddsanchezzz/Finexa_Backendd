// src/reports/pdf.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

@Injectable()
export class PdfService implements OnModuleDestroy {
  private browser: Browser | null = null;

  private async getBrowser() {
    if (this.browser) return this.browser;

    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    return this.browser;
  }

  async htmlToPdfBuffer(html: string) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    // Evita flashes y asegura CSS aplicado
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
    });

    await page.close();
    return Buffer.from(pdf);
  }

  async onModuleDestroy() {
    if (this.browser) await this.browser.close();
    this.browser = null;
  }
}
