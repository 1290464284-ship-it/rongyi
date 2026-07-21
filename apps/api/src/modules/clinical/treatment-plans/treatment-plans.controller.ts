import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Controller, Post, Get, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { TreatmentPlan } from '@dental/shared';
import { TreatmentPlansService } from './treatment-plans.service';
import { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import { UpdateTreatmentPlanDto } from './dto/update-treatment-plan.dto';
import { QueryTreatmentPlanDto } from './dto/query-treatment-plan.dto';
import { UpdatePlanStatusDto } from './dto/update-plan-status.dto';
import { UpdatePlanItemStatusDto } from './dto/update-plan-item-status.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';

@ApiTags('治疗计划')
@Controller('treatment-plans')
@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
export class TreatmentPlansController {
  constructor(private plans: TreatmentPlansService) {}

  @Post()
  create(@Body() dto: CreateTreatmentPlanDto) {
    return this.plans.create(dto as unknown as Partial<TreatmentPlan>);
  }

  @Get()
  findAll(@Query() dto: QueryTreatmentPlanDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.plans.findMany({ ...dto, page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.plans.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTreatmentPlanDto) {
    return this.plans.update(id, dto as unknown as Partial<TreatmentPlan>);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePlanStatusDto) {
    return this.plans.updateStatus(id, dto);
  }

  @Patch(':id/items/:itemId/status')
  updateItemStatus(
    @Param('id') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePlanItemStatusDto,
  ) {
    return this.plans.updateItemStatus(planId, itemId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.plans.remove(id);
  }
}
