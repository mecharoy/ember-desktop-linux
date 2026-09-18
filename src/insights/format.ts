// Small formatters the Insights modules share.

/** A date key as "5 Sep" in the reader's locale. Noon avoids the entry
 *  landing on the day before in timezones behind UTC. */
export function shortDate(dateKey: string): string {
  return new Date(`${dateKey.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
