// src/reports/reports.controller.ts
import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { User } from 'src/common/decorators/user.decorator';
import { ReportsService } from './reports.service';
import { PdfService } from './pdf.service';
import { monthlyReportHtml } from './templates/monthly-report';
import { yearlyReportHtml } from './templates/yearly-report';
import { toMonthlyTemplateParams, toYearlyTemplateParams } from './reports.presenter';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly pdfService: PdfService,
  ) {}

  @Get('monthly/pdf')
  @Header('Content-Type', 'application/pdf')
  async getMonthlyPdf(
    @User('id') userId: number,
    @Query('month') month: string, // YYYY-MM
    @Query('walletId') walletId?: string,
    @Query('currency') currency?: string,
  ) {
    const report = await this.reportsService.getMonthlyReport(userId, {
      month,
      walletId: walletId ? Number(walletId) : undefined,
    });

    const html = monthlyReportHtml(toMonthlyTemplateParams(report, currency || 'EUR'));
    const pdfBuffer = await this.pdfService.htmlToPdfBuffer(html);

    // Para que el navegador lo “descargue” con nombre (opcional)
    // Si lo quieres inline en webview, cambia attachment -> inline
    return new StreamableFile(pdfBuffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="informe-mensual-${month}.pdf"`,
    });
  }

  @Get('yearly/pdf')
  @Header('Content-Type', 'application/pdf')
  async getYearlyPdf(
    @User('id') userId: number,
    @Query('year') year: string, // YYYY
    @Query('walletId') walletId?: string,
    @Query('currency') currency?: string,
  ) {
    const report = await this.reportsService.getYearlyReport(userId, {
      year,
      walletId: walletId ? Number(walletId) : undefined,
    });

    const html = yearlyReportHtml(toYearlyTemplateParams(report, currency || 'EUR'));
    const pdfBuffer = await this.pdfService.htmlToPdfBuffer(html);

    return new StreamableFile(pdfBuffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="informe-anual-${year}.pdf"`,
    });
  }
}
