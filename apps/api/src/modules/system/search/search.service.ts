import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { escapeLike } from "../../../common/utils/db/validate-name";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { maskPhone } from "../../../common/utils/security/mask";
import { SEARCH_CACHE_TTL_MS } from "../../../config/constants";

const MAX_RESULTS = 100;
const PREFIX_SEARCH_MIN_RESULTS = 5;

export interface PatientSearchRow {
  id: string;
  name: string;
  code?: string;
  phone?: string;
  gender?: string;
  birthDate?: string;
}

export interface AppointmentSearchRow {
  id: string;
  patientId: string;
  doctorId?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  type?: string;
  patientName?: string;
}

function getFirstWord(keyword: string): string {
  const trimmed = keyword.trim();
  const firstSpace = trimmed.indexOf(' ');
  return firstSpace === -1 ? trimmed : trimmed.slice(0, Math.max(0, firstSpace));
}

@Injectable()
export class SearchService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async search(keyword: string) {
    const clinicId = this.clinicContext.getClinicId();
    const cacheKey = `search:${clinicId}:${keyword}`;
    return this.cache.getOrSet(cacheKey, () => this.doSearch(keyword), SEARCH_CACHE_TTL_MS);
  }

  private doSearch(keyword: string) {
    const escaped = escapeLike(keyword);
    const firstWord = escapeLike(getFirstWord(keyword));
    const prefixLike = firstWord + "%";
    const fullLike = "%" + escaped + "%";
    const clinicFilter = buildClinicFilter(this.clinicContext.getClinicId());
    const patientClinicClause = clinicFilter.clause;
    const patientClinicParams = clinicFilter.params;
    const apptClinicClause = clinicFilter.clause.replace('clinicId', 'a.clinicId');
    const apptClinicParams = clinicFilter.params;

    let patients = this.searchPatientsWithPrefix(prefixLike, patientClinicClause, patientClinicParams);
    if (patients.length < PREFIX_SEARCH_MIN_RESULTS) {
      patients = this.searchPatientsFull(fullLike, patientClinicClause, patientClinicParams);
    }
    patients = patients.slice(0, MAX_RESULTS);
    patients = patients.map((p) => {
      if (p.phone) {
        const masked = maskPhone(p.phone);
        if (masked) p.phone = masked;
      }
      return p;
    });

    let appointments = this.searchAppointmentsWithPrefix(prefixLike, apptClinicClause, apptClinicParams);
    if (appointments.length < PREFIX_SEARCH_MIN_RESULTS) {
      appointments = this.searchAppointmentsFull(fullLike, apptClinicClause, apptClinicParams);
    }
    appointments = appointments.slice(0, MAX_RESULTS);

    return { patients, appointments, total: patients.length + appointments.length };
  }

  private searchPatientsWithPrefix(prefixLike: string, clinicClause: string, clinicParams: unknown[]): PatientSearchRow[] {
    return this.dbService.prepare(
      `SELECT id, name, code, phone, gender, birthDate FROM Patient WHERE (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\') AND deletedAt IS NULL${clinicClause} LIMIT ?`
    ).all(prefixLike, prefixLike, ...clinicParams, MAX_RESULTS) as PatientSearchRow[];
  }

  private searchPatientsFull(fullLike: string, clinicClause: string, clinicParams: unknown[]): PatientSearchRow[] {
    return this.dbService.prepare(
      `SELECT id, name, code, phone, gender, birthDate FROM Patient WHERE (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\') AND deletedAt IS NULL${clinicClause} LIMIT ?`
    ).all(fullLike, fullLike, fullLike, ...clinicParams, MAX_RESULTS) as PatientSearchRow[];
  }

  private searchAppointmentsWithPrefix(prefixLike: string, clinicClause: string, clinicParams: unknown[]): AppointmentSearchRow[] {
    return this.dbService.prepare(
      `SELECT a.id, a.patientId, a.doctorId, a.startTime, a.endTime, a.status, a.type, p.name as patientName FROM Appointment a JOIN Patient p ON a.patientId = p.id WHERE p.name LIKE ? ESCAPE '\\' AND a.deletedAt IS NULL${clinicClause} LIMIT ?`
    ).all(prefixLike, ...clinicParams, MAX_RESULTS) as AppointmentSearchRow[];
  }

  private searchAppointmentsFull(fullLike: string, clinicClause: string, clinicParams: unknown[]): AppointmentSearchRow[] {
    return this.dbService.prepare(
      `SELECT a.id, a.patientId, a.doctorId, a.startTime, a.endTime, a.status, a.type, p.name as patientName FROM Appointment a JOIN Patient p ON a.patientId = p.id WHERE (p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\') AND a.deletedAt IS NULL${clinicClause} LIMIT ?`
    ).all(fullLike, fullLike, ...clinicParams, MAX_RESULTS) as AppointmentSearchRow[];
  }
}
