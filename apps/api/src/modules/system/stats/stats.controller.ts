import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { StatsService } from './stats.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';

@ApiTags('统计报表')
@OperationLogResource('统计')
@Controller('stats')
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
export class StatsController {
  constructor(private stats: StatsService) {}

  @ApiOperation({ summary: 'dashboard - 统计' })
  @Get('dashboard')
  dashboard() {
    return this.stats.dashboard();
  }

  @ApiOperation({ summary: 'revenue - 统计' })
  @Get('revenue')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  revenue(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('groupBy') groupBy?: 'day' | 'month' | 'year',
  ) {
    return this.stats.revenue({ startDate, endDate, groupBy });
  }

  @ApiOperation({ summary: 'doctorWorkload - 统计' })
  @Get('doctor-workload')
  @Roles(Role.BOSS, Role.DOCTOR)
  doctorWorkload(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.doctorWorkload({ startDate, endDate });
  }

  @ApiOperation({ summary: 'patientGrowth - 统计' })
  @Get('patient-growth')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  patientGrowth(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getPatientGrowth({ startDate, endDate });
  }

  @ApiOperation({ summary: 'revenueByCategory - 统计' })
  @Get('revenue/category')
  @Roles(Role.BOSS, Role.RECEPTIONIST)
  revenueByCategory(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getRevenueByCategory({ startDate, endDate });
  }

  @ApiOperation({ summary: 'revenueByDoctor - 统计' })
  @Get('revenue/doctor')
  @Roles(Role.BOSS, Role.DOCTOR)
  revenueByDoctor(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getRevenueByDoctor({ startDate, endDate });
  }

  @ApiOperation({ summary: 'inventoryStatus - 统计' })
  @Get('inventory')
  @Roles(Role.BOSS, Role.RECEPTIONIST)
  inventoryStatus() {
    return this.stats.getInventoryStatus();
  }

  @ApiOperation({ summary: 'appointmentStats - 统计' })
  @Get('appointments')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  appointmentStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getAppointmentStats({ startDate, endDate });
  }

  @ApiOperation({ summary: 'appointmentStatusStats - 统计' })
  @Get('appointments/status')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  appointmentStatusStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getAppointmentStats({ startDate, endDate });
  }

  @ApiOperation({ summary: 'memberStats - 统计' })
  @Get('members')
  @Roles(Role.BOSS, Role.RECEPTIONIST)
  memberStats() {
    return this.stats.getMemberStats();
  }

  @ApiOperation({ summary: 'chargeStats - 统计' })
  @Get('charges')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  chargeStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getChargeStats({ startDate, endDate });
  }

  @ApiOperation({ summary: 'patientStats - 统计' })
  @Get('patients')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  patientStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stats.getPatientStats({ startDate, endDate });
  }
}
