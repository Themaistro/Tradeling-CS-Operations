import { z } from "zod";
export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time.");
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid date.");
export const timezone = z.string().refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "Choose a valid timezone.");
export function operationToday(zone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
