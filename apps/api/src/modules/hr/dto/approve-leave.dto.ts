import { ApiProperty } from '@nestjs/swagger';

export class ApproveLeaveDto {
  @ApiProperty({ description: '审批通过（无额外参数）', example: {} })
  dummy?: string;
}
