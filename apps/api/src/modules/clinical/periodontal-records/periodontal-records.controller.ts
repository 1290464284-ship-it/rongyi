import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PeriodontalRecord } from './periodontal-records.service';
import { PeriodontalRecordsService } from './periodontal-records.service';
import { CreatePeriodontalRecordDto } from './dto/create-periodontal-record.dto';
import { QueryPeriodontalRecordDto } from './dto/query-periodontal-record.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('牙周记录')
@Controller('periodontal-records')
export class PeriodontalRecordsController {
  constructor(private records: PeriodontalRecordsService) {}

  @Get()
  findMany(@Query() q: QueryPeriodontalRecordDto) {
    return this.records.findMany({ filters: { patientId: q.patientId, visitId: q.visitId } });
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.records.findOne(id); }

  @Post()
  create(@Body() dto: CreatePeriodontalRecordDto) { return this.records.create(dto as unknown as Partial<PeriodontalRecord>); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreatePeriodontalRecordDto>) { return this.records.update(id, dto as unknown as Partial<PeriodontalRecord>); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.records.remove(id); }
}
