 
import { ApiProperty } from '@nestjs/swagger';

export class PlanProgressItemDto {
  @ApiProperty({ description: '计划项ID' })
  id!: string;

  @ApiProperty({ description: '项目编码' })
  code!: string;

  @ApiProperty({ description: '项目名称' })
  name!: string;

  @ApiProperty({ description: '治疗类别' })
  category!: string;

  @ApiProperty({ description: '计划执行日期，ISO字符串', required: false })
  plannedDate?: string;

  @ApiProperty({ description: '完成时间ISO字符串', required: false })
  completedAt?: string;

  @ApiProperty({ description: '状态：PLANNED/IN_PROGRESS/COMPLETED/CANCELLED/SKIPPED' })
  status!: string;

  @ApiProperty({ description: '滞后天数，0表示未逾期', example: 0 })
  daysLate!: number;

  @ApiProperty({ description: '关联治疗ID', required: false })
  treatmentId?: string;

  @ApiProperty({ description: '关联治疗状态，当treatmentId存在时回填', required: false })
  linkedTreatmentStatus?: string;

  @ApiProperty({ description: '治疗牙位数组', type: [Number] })
  teethNumbers!: number[];

  @ApiProperty({ description: '同步提示：如"治疗已完成但未同步"', required: false })
  syncHint?: string;

  @ApiProperty({ description: '单价（分）' })
  price!: number;

  @ApiProperty({ description: '数量' })
  quantity!: number;
}

export class PlanProgressTotalsDto {
  @ApiProperty({ description: '计划项总数' })
  totalItems!: number;

  @ApiProperty({ description: '计划中项数' })
  plannedItems!: number;

  @ApiProperty({ description: '进行中项数' })
  inProgressItems!: number;

  @ApiProperty({ description: '已完成项数' })
  completedItems!: number;

  @ApiProperty({ description: '已取消项数' })
  cancelledItems!: number;

  @ApiProperty({ description: '已跳过项数' })
  skippedItems!: number;
}

export class PlanProgressDetailDto {
  @ApiProperty({ description: '治疗计划ID' })
  planId!: string;

  @ApiProperty({ description: '治疗计划名称' })
  planName!: string;

  @ApiProperty({ description: '计划状态' })
  planStatus!: string;

  @ApiProperty({ description: '创建时间ISO' })
  planCreatedAt!: string;

  @ApiProperty({ description: '完成度百分比 0-100', example: 35.0 })
  completionPercent!: number;

  @ApiProperty({ description: '计划总费用（分）' })
  plannedTotalFee!: number;

  @ApiProperty({ description: '已收金额（分）' })
  chargedAmount!: number;

  @ApiProperty({ description: '收费进度百分比 0-100' })
  paidPercent!: number;

  @ApiProperty({ description: '收费数据来源：REAL=来自Charge，ESTIMATED=从完成项估算' })
  paidSource!: 'REAL' | 'ESTIMATED';

  @ApiProperty({ description: '总逾期天数（累加所有未完成项）' })
  overdueDays!: number;

  @ApiProperty({ description: '是否拖期：0正常，1拖期（完成度<80%且逾期>阈值）' })
  behindSchedule!: number;

  @ApiProperty({ description: '进度明细项，按状态+顺序排序', type: () => [PlanProgressItemDto] })
  items!: PlanProgressItemDto[];

  @ApiProperty({ description: '各项状态合计' })
  totals!: PlanProgressTotalsDto;

  @ApiProperty({ description: '预计剩余天数（按未完成项×14天均值）', example: 70 })
  estimatedRemainingDays!: number;

  @ApiProperty({ description: '预计完成日期 ISO', required: false })
  estimatedFinishDate?: string;
}
