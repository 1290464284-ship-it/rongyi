import { ApiProperty } from '@nestjs/swagger';

export class ClinicBoardDto {
  @ApiProperty({ description: '疗程总数' })
  totalPlans!: number;

  @ApiProperty({ description: 'IN_PROGRESS 疗程数' })
  inProgressPlans!: number;

  @ApiProperty({ description: 'COMPLETED 疗程数' })
  completedPlans!: number;

  @ApiProperty({ description: 'CANCELLED 疗程数' })
  cancelledPlans!: number;

  @ApiProperty({ description: 'SUBMITTED 疗程数' })
  submittedPlans!: number;

  @ApiProperty({ description: 'APPROVED 疗程数' })
  approvedPlans!: number;

  @ApiProperty({ description: '平均疗程完成度（按 plannedTotalFee 加权）' })
  weightedAvgCompletion!: number;

  @ApiProperty({ description: '计划总预期收入（所有疗程 plannedTotalFee 求和，分）' })
  plannedTotalRevenue!: number;

  @ApiProperty({ description: '已收金额（分）' })
  chargedRevenue!: number;

  @ApiProperty({ description: '收入完成度 = chargedRevenue / plannedTotalRevenue * 100' })
  revenueCompletionPercent!: number;

  @ApiProperty({ description: '滞后天数 TOP 5 疗程', type: () => [Object] })
  overdueTop5Plans!: Array<{
    planId: string;
    planName: string;
    doctorId: string;
    completionPercent: number;
    overdueDays: number;
    plannedTotalFee: number;
  }>;
}
