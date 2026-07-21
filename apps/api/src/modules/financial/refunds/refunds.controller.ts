import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { QueryRefundDto } from './dto/query-refund.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS)
@ApiTags('退款管理')
@Controller('refunds')
export class RefundsController {
  constructor(private refunds: RefundsService) {}

  @Get()
  findMany(
    @Query() q: QueryRefundDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.refunds.findMany(q, safePage(page), safePageSize(pageSize, 50));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.refunds.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateRefundDto, @Request() req: ExpressRequest) {
    return this.refunds.create(dto, req.user);
  }
}
