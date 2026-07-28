import { Injectable } from '@nestjs/common';
import { BackupAutoService } from "./backup-auto.service";
import { BackupManualService } from "./backup-manual.service";

@Injectable()
export class BackupsService {
  constructor(
    private autoBackup: BackupAutoService,
    private manualBackup: BackupManualService,
  ) {}

  // Delegate manual operations
  async findMany() {
    return this.manualBackup.findMany();
  }

  async create(type: string | undefined, remark: string | undefined, user: Record<string, unknown>) {
    return this.manualBackup.create(type, remark, user);
  }

  async restore(filename: string, user: Record<string, unknown>) {
    return this.manualBackup.restore(filename, user);
  }

  async delete(filename: string) {
    return this.manualBackup.delete(filename);
  }

  async removeById(id: string) {
    return this.manualBackup.removeById(id);
  }

  async restoreById(id: string, user: Record<string, unknown>) {
    return this.manualBackup.restoreById(id, user);
  }

  async list() {
    return this.manualBackup.list();
  }

  async drill() {
    return this.manualBackup.drill();
  }

  async verifyBackup(id: string) {
    return this.manualBackup.verifyBackup(id);
  }

  // Delegate auto operations
  async performAutoBackup() {
    return this.autoBackup.performAutoBackup();
  }

  async ensureDailyBackup() {
    return this.autoBackup.ensureDailyBackup();
  }

  async cleanupOldAutoBackups() {
    return this.autoBackup.cleanupOldAutoBackups();
  }

  async performAutoVerify() {
    return this.autoBackup.performAutoVerify();
  }
}
