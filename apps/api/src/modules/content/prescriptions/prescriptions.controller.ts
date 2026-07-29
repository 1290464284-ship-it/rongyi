import { Controller, Post, Get, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { PrescriptionsService } from './prescriptions.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { QueryPrescriptionDto } from './dto/query-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';

@ApiTags('处方管理')
@OperationLogResource('处方')
@Controller('prescriptions')
@Roles(Role.BOSS, Role.DOCTOR)
export class PrescriptionsController {
  constructor(private prescriptions: PrescriptionsService) {}

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreatePrescriptionDto) {
    return this.prescriptions.create(dto);
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() dto: QueryPrescriptionDto) {
    return this.prescriptions.findMany(dto);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prescriptions.findOne(id);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePrescriptionDto) {
    return this.prescriptions.update(id, dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prescriptions.remove(id);
  }
}
