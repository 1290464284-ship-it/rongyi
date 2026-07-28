import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../common/decorators/operation-log-resource.decorator';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { QueryPatientDto } from './dto/query-patient.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('患者管理')
@OperationLogResource('患者')
@Controller('patients')
export class PatientsController {
  constructor(private patients: PatientsService) {}

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreatePatientDto) {
    return this.patients.create(dto);
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryPatientDto) {
    return this.patients.findMany(q);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patients.findOne(id);
  }

  @ApiOperation({ summary: '获取完整身份证号' })
  @Get(':id/full-id-card')
  @Roles(Role.BOSS)
  async getFullIdCard(@Param('id') id: string): Promise<{ idCard: string | null }> {
    const idCard = await this.patients.getFullIdCard(id);
    return { idCard };
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patients.update(id, dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.patients.remove(id);
  }
}
