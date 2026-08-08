import { CLINIC_TZ_OFFSET_HOURS } from '../../domain/contracts';

export class SystemClock {
  now(): Date {
    return new Date();
  }

  clinicDate(input: Date | string | number = new Date()): string {
    // Asia/Shanghai = +8 hours
    const date = input instanceof Date ? input : new Date(input);
    const shifted = new Date(date.getTime() + CLINIC_TZ_OFFSET_HOURS * 3_600_000);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Converts a clinic date (Asia/Shanghai) to the UTC instant of its 00:00. */
export function clinicDayStartUtc(value: string): string | null {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return new Date(date.getTime() - CLINIC_TZ_OFFSET_HOURS * 3_600_000).toISOString();
}

/** Converts a clinic date (Asia/Shanghai) to the UTC instant of its 23:59:59.999. */
export function clinicDayEndUtc(value: string): string | null {
  const start = clinicDayStartUtc(value);
  if (start === null) return null;
  return new Date(new Date(start).getTime() + 86_400_000 - 1).toISOString();
}
