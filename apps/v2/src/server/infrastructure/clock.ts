import { CLINIC_TZ_OFFSET_HOURS } from '../../domain/contracts';

export class SystemClock {
  now(): Date {
    return new Date();
  }

  clinicDate(input: Date | string | number = new Date()): string {
    const date = input instanceof Date ? input : new Date(input);
    const shifted = new Date(date.getTime() + CLINIC_TZ_OFFSET_HOURS * 3_600_000);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

