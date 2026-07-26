import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { QueryRefundDto } from './dto/query-refund.dto';

@Roles(Role.BOSS)
@ApiTags('退款管理')
@OperationLogResource('退款')
@Controller('refunds')
export class RefundsController {
  constructor(private refunds: RefundsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(
    @Query() q: QueryRefundDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.refunds.findMany({
      filters: { patientId: q.patientId, chargeId: q.chargeId },
      page: safePage(page),
      pageSize: safePageSize(pageSize, 50),
    });
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.refunds.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateRefundDto, @Request() req: ExpressRequest) {
    return this.refunds.createRefund(dto, req.user);
  }
}
