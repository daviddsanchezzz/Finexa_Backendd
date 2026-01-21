// src/modules/trips/services/aerodatabox.service.ts
import {
  Injectable,
  BadGatewayException,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import axios, { AxiosError } from "axios";

type ADBFlight = {
  number?: string; // "FR 6341"
  status?: string;
  lastUpdatedUtc?: string;

  airline?: { name?: string; iata?: string; icao?: string };

  departure?: {
    airport?: {
      iata?: string;
      icao?: string;
      name?: string;
      shortName?: string;
      municipalityName?: string;
      countryCode?: string;
      timeZone?: string;
    };
    scheduledTime?: { utc?: string; local?: string }; // "2026-04-03 14:00Z"
    terminal?: string;
  };

  arrival?: {
    airport?: {
      iata?: string;
      icao?: string;
      name?: string;
      shortName?: string;
      municipalityName?: string;
      countryCode?: string;
      timeZone?: string;
    };
    scheduledTime?: { utc?: string; local?: string };
    predictedTime?: { utc?: string; local?: string };
    terminal?: string;
  };

  aircraft?: { model?: string };
};

@Injectable()
export class AerodataboxService {
  private readonly logger = new Logger(AerodataboxService.name);

  // ✅ Tu backend gateway (MagicAPI) + Aerodatabox
  private readonly BASE_URL = "https://prod.api.market/api/v1/aedbx/aerodatabox";
  private readonly MAGIC_KEY = process.env.MAGICAPI_KEY;

  /**
   * Obtiene un vuelo por número y fecha usando:
   * GET /flights/number/:flightNumber/:date
   * Header x-magicapi-key, Accept
   *
   * Devuelve un payload ya "limpio" para tu app (solo lo necesario).
   */
  async getFlightByNumberAndDate(flightNumber: string, date: string) {
    if (!this.MAGIC_KEY) throw new Error("MAGICAPI_KEY not set");

    const fn = (flightNumber || "").trim().toUpperCase();
    if (!fn) throw new BadRequestException("flightNumber requerido");

    // date = YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("date debe ser YYYY-MM-DD");
    }

    const path = `/flights/number/${encodeURIComponent(fn)}/${date}`;

    try {
      const res = await axios.get<ADBFlight[]>(`${this.BASE_URL}${path}`, {
        headers: {
          "x-magicapi-key": this.MAGIC_KEY,
          Accept: "application/json",
        },
        timeout: 12_000,
      });

      const flights = Array.isArray(res.data) ? res.data : [];
      if (!flights.length) throw new NotFoundException(`No se encontró el vuelo ${fn} para ${date}`);

      // Aerodatabox a veces devuelve varios legs/variantes -> nos quedamos con el primero
      const f = flights[0];

      // ✅ Guardamos lo mínimo útil para tu plan-item
      const departureLocal = f?.departure?.scheduledTime?.local ?? null;
      const arrivalLocal = f?.arrival?.scheduledTime?.local ?? f?.arrival?.predictedTime?.local ?? null;

      const fromIata = f?.departure?.airport?.iata ?? null;
      const toIata = f?.arrival?.airport?.iata ?? null;

      return {
        airline: f?.airline?.name ?? null,
        airlineIata: f?.airline?.iata ?? null,
        flightNumber: (f?.number ?? fn).replace(/\s+/g, " ").trim(), // "FR 6341"
        from: {
          iata: fromIata,
          airport: f?.departure?.airport?.name ?? f?.departure?.airport?.shortName ?? null,
          city: f?.departure?.airport?.municipalityName ?? null,
          timezone: f?.departure?.airport?.timeZone ?? null,
        },
        to: {
          iata: toIata,
          airport: f?.arrival?.airport?.name ?? f?.arrival?.airport?.shortName ?? null,
          city: f?.arrival?.airport?.municipalityName ?? null,
          timezone: f?.arrival?.airport?.timeZone ?? null,
        },
        departureTimeLocal: departureLocal, // "2026-04-03 16:00+02:00"
        arrivalTimeLocal: arrivalLocal,     // "2026-04-03 17:55+02:00" (o predicted)
        terminals: {
          departure: f?.departure?.terminal ?? null,
          arrival: f?.arrival?.terminal ?? null,
        },
        status: f?.status ?? null,
        aircraftModel: f?.aircraft?.model ?? null,
        lastUpdatedUtc: f?.lastUpdatedUtc ?? null,
      };
    } catch (e: any) {
      if (!axios.isAxiosError(e)) throw e;

      const err = e as AxiosError<any>;
      const status = err.response?.status;

      this.logger.error(
        `Aerodatabox failed status=${status} msg=${err.message} data=${JSON.stringify(err.response?.data)}`
      );

      // Propagamos 404 limpio si el provider devuelve 404
      if (status === 404) {
        throw new NotFoundException(`No se encontró el vuelo ${fn} para ${date}`);
      }

      // 401/403 típicamente key mala o permisos
      if (status === 401 || status === 403) {
        throw new BadGatewayException({
          code: "AERODATABOX_FORBIDDEN",
          providerStatus: status,
          providerData: err.response?.data,
        });
      }

      // resto
      throw new BadGatewayException({
        code: "AERODATABOX_ERROR",
        providerStatus: status ?? null,
        providerData: err.response?.data,
      });
    }
  }
}
