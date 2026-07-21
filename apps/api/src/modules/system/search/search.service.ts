import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";

/** Escape SQLite LIKE wildcards from user input to prevent wildcard injection */
function escapeLike(input: string): string {
  return input.replace(/[%_]/g, '\\$&');
}

@Injectable()
export class SearchService {
  constructor(private dbService: DbService) {}

  async search(keyword: string) {
    const escaped = escapeLike(keyword);
    // Use ESCAPE '\' clause so that literal \% and \_ are matched
    const like = "%" + escaped + "%";
    const patients = this.dbService.prepare(
      "SELECT id, name, code, phone, gender, birthDate FROM Patient WHERE (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\') AND deletedAt IS NULL LIMIT 20"
    ).all(like, like, like) as Record<string, unknown>[];
    const appointments = this.dbService.prepare(
      "SELECT a.id, a.patientId, a.doctorId, a.startTime, a.endTime, a.status, a.type, p.name as patientName FROM Appointment a JOIN Patient p ON a.patientId = p.id WHERE (p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\') AND a.deletedAt IS NULL LIMIT 20"
    ).all(like, like) as Record<string, unknown>[];
    return { patients, appointments, total: patients.length + appointments.length };
  }
}
