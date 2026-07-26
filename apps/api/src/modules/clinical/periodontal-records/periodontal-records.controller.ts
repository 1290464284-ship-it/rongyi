import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { PeriodontalRecordsService } from './periodontal-records.service';
import { CreatePeriodontalRecordDto } from './dto/create-periodontal-record.dto';
import { QueryPeriodontalRecordDto } from './dto/query-periodontal-record.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('牙周记录')
@OperationLogResource('牙周记录')
@Controller('periodontal-records')
export class PeriodontalRecordsController {
  constructor(private records: PeriodontalRecordsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryPeriodontalRecordDto) {
    return this.records.findMany({ filters: { patientId: q.patientId, visitId: q.visitId } });
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) { return this.records.findOne(id); }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreatePeriodontalRecordDto) { return this.records.create(dto); }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreatePeriodontalRecordDto>) { return this.records.update(id, dto); }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) { return this.records.remove(id); }
}
