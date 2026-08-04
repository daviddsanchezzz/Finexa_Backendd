import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { TripsService } from "./trips.service";

@Injectable()
export class TripsRemindersScheduler {
  private readonly logger = new Logger(TripsRemindersScheduler.name);

  constructor(private readonly tripsService: TripsService) {}

  // Cada 5 minutos: traslados/vuelos a punto de salir y check-in/check-out
  // de alojamientos.
  @Cron("0 */5 * * * *")
  async handleTripReminders() {
    try {
      await this.tripsService.checkUpcomingDepartures();
      await this.tripsService.checkAccommodationEvents();
    } catch (error) {
      this.logger.error("Error al procesar recordatorios de viaje", error);
    }
  }
}
