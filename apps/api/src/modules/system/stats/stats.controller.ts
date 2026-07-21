import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';

@ApiTags('统计报表')
@Controller('stats')
@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
export class StatsController {
  constructor(private stats: StatsService) {}

  @Get('dashboard')
  dashboard() {
    return this.stats.dashboard();
  }

  @Get('revenue')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  revenue(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('groupBy') groupBy?: 'day' | 'month' | 'year',
  ) {
    return this.stats.revenue({ startDate, endDate, groupBy });
  }

  @Get('doctor-workload')
  @Roles(Role.BOSS, Role.DOCTOR)
  doctorWorkload(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.doctorWorkload({ startDate, endDate });
  }

  @Get('patient-growth')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  patientGrowth(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getPatientGrowth({ startDate, endDate });
  }

  @Get('revenue/category')
  @Roles(Role.BOSS, Role.RECEPTIONIST)
  revenueByCategory(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getRevenueByCategory({ startDate, endDate });
  }

  @Get('revenue/doctor')
  @Roles(Role.BOSS, Role.DOCTOR)
  revenueByDoctor(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getRevenueByDoctor({ startDate, endDate });
  }

  @Get('inventory')
  @Roles(Role.BOSS, Role.RECEPTIONIST)
  inventoryStatus() {
    return this.stats.getInventoryStatus();
  }

  @Get('appointments')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  appointmentStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getAppointmentStats({ startDate, endDate });
  }

  @Get('appointments/status')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  appointmentStatusStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getAppointmentStats({ startDate, endDate });
  }

  @Get('members')
  @Roles(Role.BOSS, Role.RECEPTIONIST)
  memberStats() {
    return this.stats.getMemberStats();
  }

  @Get('charges')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  chargeStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getChargeStats({ startDate, endDate });
  }

  @Get('patients')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  patientStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getPatientStats({ startDate, endDate });
  }
}
