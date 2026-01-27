import { Injectable, InternalServerErrorException } from "@nestjs/common";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { MonthlyReportPdf, MonthlyParams } from "./monthly-report.pdf";
import { YearlyReportPdf, YearlyParams } from "./yearly-report.pdf";

@Injectable()
export class PdfService {
  async monthlyPdfBuffer(params: MonthlyParams): Promise<Buffer> {
    try {
      return await renderToBuffer(<MonthlyReportPdf p={params} />);
    } catch (e: any) {
      throw new InternalServerErrorException(`Error generando PDF mensual: ${e?.message ?? e}`);
    }
  }

  async yearlyPdfBuffer(params: YearlyParams): Promise<Buffer> {
    try {
      return await renderToBuffer(<YearlyReportPdf p={params} />);
    } catch (e: any) {
      throw new InternalServerErrorException(`Error generando PDF anual: ${e?.message ?? e}`);
    }
  }
}
