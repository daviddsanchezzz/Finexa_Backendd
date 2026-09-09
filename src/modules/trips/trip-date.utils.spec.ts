import { hasTripEnded, tripTodayStartUtc } from "./trip-date.utils";

describe("trip date boundaries", () => {
  it("uses midnight in Europe/Madrid as the daily cutoff", () => {
    const summer = tripTodayStartUtc(new Date("2026-09-09T10:00:00.000Z"));
    const winter = tripTodayStartUtc(new Date("2026-01-09T10:00:00.000Z"));

    expect(summer.toISOString()).toBe("2026-09-08T22:00:00.000Z");
    expect(winter.toISOString()).toBe("2026-01-08T23:00:00.000Z");
  });

  it("keeps a trip active throughout its final calendar day", () => {
    const endDate = new Date("2026-09-08T22:00:00.000Z"); // 9 Sep at 00:00 in Madrid

    expect(hasTripEnded(endDate, new Date("2026-09-09T20:00:00.000Z"))).toBe(false);
    expect(hasTripEnded(endDate, new Date("2026-09-09T22:00:00.000Z"))).toBe(true);
  });
});
