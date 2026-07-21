import { Body, Controller, Get, Param, Patch, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ClinicsService } from './clinics.service';
import { CreateClinicDto, UpdateClinicDto } from './dto/clinic.dto';

@ApiTags('诊所管理')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS)
@Controller('clinics')
export class ClinicsController {
  constructor(private clinics: ClinicsService) {}

  @Get()
  @ApiOperation({ summary: '获取诊所列表' })
  findAll(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.clinics.findMany({ page: Number(page) || 1, pageSize: Number(pageSize) || 50, skipClinicFilter: true });
  }

  @Get('active')
  @ApiOperation({ summary: '获取所有活跃诊所（供选择）' })
  findActive() {
    return this.clinics.findActive();
  }

  @Get('current')
  @ApiOperation({ summary: '获取当前用户的诊所信息' })
  getCurrentClinic() {
    return this.clinics.getCurrentClinic();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取诊所详情' })
  findOne(@Param('id') id: string) {
    return this.clinics.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建诊所' })
  create(@Body() dto: CreateClinicDto) {
    return this.clinics.create(dto as any);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新诊所信息' })
  update(@Param('id') id: string, @Body() dto: UpdateClinicDto) {
    return this.clinics.update(id, dto as any);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除诊所（软删除）' })
  remove(@Param('id') id: string) {
    return this.clinics.softDelete(id);
  }
}
