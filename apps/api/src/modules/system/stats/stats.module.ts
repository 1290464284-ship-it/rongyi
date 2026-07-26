import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { DashboardStatsService } from './dashboard-stats.service';
import { RevenueStatsService } from './revenue-stats.service';
import { PatientStatsService } from './patient-stats.service';
import { AppointmentStatsService } from './appointment-stats.service';
import { ChargeStatsService } from './charge-stats.service';
import { InventoryStatsService } from './inventory-stats.service';
import { MemberStatsService } from './member-stats.service';
import { DoctorStatsService } from './doctor-stats.service';

@Module({
  controllers: [StatsController],
  providers: [
    StatsService,
    DashboardStatsService,
    RevenueStatsService,
    PatientStatsService,
    AppointmentStatsService,
    ChargeStatsService,
    InventoryStatsService,
    MemberStatsService,
    DoctorStatsService,
  ],
  exports: [StatsService],
})
export class StatsModule {}
