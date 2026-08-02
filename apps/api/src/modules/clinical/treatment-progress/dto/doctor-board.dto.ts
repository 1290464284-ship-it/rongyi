 
import { ApiProperty } from '@nestjs/swagger';

export class OverduePlanTopDto {
  @ApiProperty({ description: '治疗计划ID' })
  planId!: string;

  @ApiProperty({ description: '治疗计划名称' })
  planName!: string;

  @ApiProperty({ description: '医生ID' })
  doctorId!: string;

  @ApiProperty({ description: '完成度百分比' })
  completionPercent!: number;

  @ApiProperty({ description: '逾期天数' })
  overdueDays!: number;
}

export class DoctorBoardDto {
  @ApiProperty({ description: '医生ID，查询时返回' })
  doctorId?: string;

  @ApiProperty({ description: '进行中疗程数' })
  inProgressPlans!: number;

  @ApiProperty({ description: '疗程总数（已取消计入）' })
  totalPlans!: number;

  @ApiProperty({ description: '已完成疗程数' })
  completedPlans!: number;

  @ApiProperty({ description: '计划完成占比 = 已完成 / GREATEST(1,总数) * 100' })
  planCompletionRate!: number;

  @ApiProperty({ description: '平均完成度（各计划 completionPercent 的均值）' })
  avgCompletion!: number;

  @ApiProperty({ description: '平均滞后天数（各计划 overdueDays 的均值）' })
  avgOverdueDays!: number;

  @ApiProperty({ description: '逾期计划 TOP3', type: () => [OverduePlanTopDto] })
  overdueTopPlans!: OverduePlanTopDto[];

  @ApiProperty({ description: '预期收入（完成度100%时总 plannedFee 求和，分）' })
  expectedRevenue!: number;

  @ApiProperty({ description: '实际已收金额（分）' })
  chargedRevenue!: number;

  @ApiProperty({ description: '收入完成百分比 = chargedRevenue / expectedRevenue * 100（expected为0时0）' })
  revenueCompletionPercent!: number;
}
