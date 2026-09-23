// Local wall-clock timestamps. Elytra stores times as the user's own clock
// reading rather than UTC: a day's entry belongs to the day it felt like,
// and the journal is never read in another timezone.

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** `YYYY-MM-DD` for a date in local time. */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DDTHH:MM:SS`, local. The shape every `created_at`/`updated_at`
 *  column in the database uses. */
export function localStamp(date: Date = new Date()): string {
  return (
    `${localDateKey(date)}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** The same instant with milliseconds and the UTC offset spelled out, e.g.
 *  `2026-09-18T20:15:03.412+05:30`. Sessions and entries carry this fuller
 *  form so sync can order two devices' writes. */
export function isoNowLocal(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const offH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offM = pad(Math.abs(offsetMin) % 60);
  return `${localStamp(date)}.${pad(date.getMilliseconds(), 3)}${sign}${offH}:${offM}`;
}
