import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";

export type ISODate = string; // "yyyy-MM-dd"

export const todayISO = (): ISODate => format(new Date(), "yyyy-MM-dd");
export const nowISO = (): string => new Date().toISOString();

export function toISO(date: Date | string): ISODate {
  return typeof date === "string" ? format(parseISO(date), "yyyy-MM-dd") : format(date, "yyyy-MM-dd");
}

export function addDaysISO(days: number, from: Date | string = new Date()): ISODate {
  const base = typeof from === "string" ? parseISO(from) : from;
  return format(addDays(base, days), "yyyy-MM-dd");
}

export function parseISOStart(dateISO: ISODate): Date {
  return startOfDay(parseISO(dateISO));
}

/** Minutes since midnight for a given ISO date at local time HH:mm */
export function minutesToClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.round(totalMinutes % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function dayLabel(dateISO: ISODate): string {
  return format(parseISO(dateISO), "EEEE, MMM d");
}

export function shortDay(dateISO: ISODate): string {
  return format(parseISO(dateISO), "EEE");
}

export function relativeDay(dateISO: ISODate): string {
  const today = startOfDay(new Date());
  const d = parseISOStart(dateISO);
  const diff = differenceInCalendarDays(d, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return format(d, "EEE, MMM d");
}

export function isPast(dateISO: ISODate): boolean {
  return isBefore(parseISOStart(dateISO), startOfDay(new Date()));
}

export function isToday(dateISO: ISODate): boolean {
  return isSameDay(parseISO(dateISO), new Date());
}

export function isFutureOrToday(dateISO: ISODate): boolean {
  return !isPast(dateISO);
}

export function minutesBetween(fromISO: string, toISO: string): number {
  return Math.max(0, Math.round((parseISO(toISO).getTime() - parseISO(fromISO).getTime()) / 60000));
}

/** 8:30 -> 510 */
export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** For a past range check whether time is after `other` */
export function isAfterDate(a: ISODate, b: ISODate): boolean {
  return isAfter(parseISOStart(a), parseISOStart(b));
}

/** number of calendar days from today until dateISO (negative if past) */
export function daysUntil(dateISO: ISODate): number {
  return differenceInCalendarDays(parseISOStart(dateISO), startOfDay(new Date()));
}

export function plusMinutes(date: Date, minutes: number): Date {
  return addMinutes(date, minutes);
}
