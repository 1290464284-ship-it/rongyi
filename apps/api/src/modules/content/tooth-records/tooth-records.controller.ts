import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { ToothRecordsService } from './tooth-records.service';
import { UpsertToothDto } from './dto/upsert-tooth.dto';
import { QueryToothDto } from './dto/query-tooth.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('牙位记录')
@OperationLogResource('牙位记录')
@Controller('tooth-records')
export class ToothRecordsController {
  constructor(private teeth: ToothRecordsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryToothDto) {
    return this.teeth.findByPatient(q.patientId);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':toothNumber')
  findOne(@Query('patientId') patientId: string, @Param('toothNumber') toothNumber: number) {
    return this.teeth.findByTooth(patientId, Number(toothNumber));
  }

  @ApiOperation({ summary: 'upsert - 牙位记录' })
  @Post()
  upsert(@Body() dto: UpsertToothDto) {
    return this.teeth.upsert(dto.patientId, dto.toothNumber, dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':toothNumber')
  remove(@Query('patientId') patientId: string, @Param('toothNumber') toothNumber: number) {
    return this.teeth.removeByTooth(patientId, Number(toothNumber));
  }
}
