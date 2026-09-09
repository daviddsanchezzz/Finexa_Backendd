import { DateTime } from "luxon";

export const TRIP_TIME_ZONE = "Europe/Madrid";

/** UTC instant at which the current calendar day starts for trip dates. */
export function tripTodayStartUtc(now: Date = new Date()): Date {
  return DateTime.fromJSDate(now)
    .setZone(TRIP_TIME_ZONE)
    .startOf("day")
    .toUTC()
    .toJSDate();
}

/** Trip end dates are inclusive: a trip expires when the following day starts. */
export function hasTripEnded(endDate: Date, now: Date = new Date()): boolean {
  return endDate.getTime() < tripTodayStartUtc(now).getTime();
}
