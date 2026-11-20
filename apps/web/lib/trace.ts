// Egg transfer / setting trace helpers (pure, unit-tested).

/** Transfer Reference shared by farm and hatchery, e.g. ET-261120-K7QM. Random tail: unique per tenant without a counter round-trip. */
export function transferRef(sentOn: string, rand: () => number = Math.random): string {
  const tail = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rand() * 32)]).join('');
  return `ET-${sentOn.replaceAll('-', '').slice(2)}-${tail}`;
}

/** Eggs of a received transfer still free to set: received - rejects - already loaded. */
export const settleable = (receivedQty: number | null, rejects: number, loaded: number) => Math.max(0, (receivedQty ?? 0) - rejects - loaded);

/** Age in days of the oldest egg when the setting is placed. */
export const eggAgeDays = (laidFrom: string, placedOn: string) => Math.round((Date.parse(placedOn) - Date.parse(laidFrom)) / 864e5);
