export type WorldContinent = "europe" | "africa" | "asia" | "america" | "oceania";

export interface WorldCountry {
  code: string;
  continent: WorldContinent;
}

const EUROPE: string[] = ["AL","AD","AT","BY","BE","BA","BG","HR","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IE","IT","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO","RU","SM","RS","SK","SI","ES","SE","CH","UA","GB","VA"];
const AFRICA: string[] = ["DZ","AO","BJ","BW","BF","BI","CV","CM","CF","TD","KM","CG","CD","DJ","EG","GQ","ER","SZ","ET","GA","GM","GH","GN","GW","CI","KE","LS","LR","LY","MG","MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW","ST","SN","SC","SL","SO","ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW"];
const ASIA: string[] = ["AF","AM","AZ","BH","BD","BT","BN","KH","CN","CY","GE","IN","ID","IR","IQ","IL","JP","JO","KZ","KW","KG","LA","LB","MY","MV","MN","MM","NP","KP","OM","PK","PS","PH","QA","SA","SG","KR","LK","SY","TJ","TH","TL","TR","TM","AE","UZ","VN","YE"];
const AMERICA: string[] = ["AG","BS","BB","BZ","CA","CR","CU","DM","DO","SV","GD","GT","HT","HN","JM","MX","NI","PA","KN","LC","VC","TT","US","AR","BO","BR","CL","CO","EC","GY","PY","PE","SR","UY","VE"];
const OCEANIA: string[] = ["AU","FJ","KI","MH","FM","NR","NZ","PW","PG","WS","SB","TO","TV","VU"];

export const CONTINENT_ORDER: WorldContinent[] = ["europe", "asia", "america", "africa", "oceania"];

export const COUNTRIES: WorldCountry[] = [
  ...EUROPE.map((code) => ({ code, continent: "europe" as const })),
  ...ASIA.map((code) => ({ code, continent: "asia" as const })),
  ...AMERICA.map((code) => ({ code, continent: "america" as const })),
  ...AFRICA.map((code) => ({ code, continent: "africa" as const })),
  ...OCEANIA.map((code) => ({ code, continent: "oceania" as const })),
];

export function safePct(num: number, den: number): number {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 100);
}
