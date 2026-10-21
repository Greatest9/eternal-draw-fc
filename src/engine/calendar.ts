export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Seasons start on 1 August of the following year. */
export function nextSeasonStart(iso: string): string {
  return `${Number(iso.slice(0, 4)) + 1}-08-01`;
}
