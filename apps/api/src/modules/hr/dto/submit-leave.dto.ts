import { ApiProperty } from '@nestjs/swagger';

export class SubmitLeaveDto {
  @ApiProperty({ description: '提交请假申请（无额外参数）', example: {} })
  dummy?: string;
}
