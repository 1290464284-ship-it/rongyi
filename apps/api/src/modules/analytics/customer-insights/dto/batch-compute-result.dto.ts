import { ApiProperty } from '@nestjs/swagger';

export class BatchComputeResultDto {
  @ApiProperty({ description: '处理的患者数量', example: 100 })
  processed!: number;

  @ApiProperty({
    description: '各分段患者数统计',
    example: {
      '重要价值': 15,
      '重要发展': 12,
      '重要保持': 10,
      '重要挽留': 8,
      '一般价值': 20,
      '一般发展': 15,
      '一般保持': 10,
      '流失': 10,
    },
  })
  segmentBreakdown!: Record<string, number>;
}
