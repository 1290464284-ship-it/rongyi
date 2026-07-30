import { Body, Controller, Get, Param, Patch, Post, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { ClinicsService, Clinic } from './clinics.service';
import { CreateClinicDto, UpdateClinicDto } from './dto/clinic.dto';

@ApiTags('诊所管理')
@OperationLogResource('clinics')
@ApiBearerAuth('JWT-auth')
@Roles(Role.BOSS)
@Controller('clinics')
export class ClinicsController {
  constructor(private clinics: ClinicsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  @ApiOperation({ summary: '获取诊所列表' })
  findAll(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.clinics.findMany({ page: Number(page) || 1, pageSize: Number(pageSize) || 50, skipClinicFilter: true });
  }

  @ApiOperation({ summary: '获取诊所' })
  @Get('active')
  @ApiOperation({ summary: '获取所有活跃诊所（供选择）' })
  findActive() {
    return this.clinics.findActive();
  }

  @ApiOperation({ summary: '获取诊所' })
  @Get('current')
  @ApiOperation({ summary: '获取当前用户的诊所信息' })
  // 顶栏需展示当前诊所，所有登录角色均可读取自己所属诊所（handler 级 @Roles 覆盖类级 BOSS 限制）
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST, Role.NURSE, Role.ADMIN, Role.TECHNICIAN)
  getCurrentClinic() {
    return this.clinics.getCurrentClinic();
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  @ApiOperation({ summary: '获取诊所详情' })
  findOne(@Param('id') id: string) {
    return this.clinics.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  @ApiOperation({ summary: '创建诊所' })
  create(@Body() dto: CreateClinicDto) {
    return this.clinics.create(dto);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  @ApiOperation({ summary: '更新诊所信息' })
  update(@Param('id') id: string, @Body() dto: UpdateClinicDto) {
    return this.clinics.update(id, dto as unknown as Partial<Clinic>);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  @ApiOperation({ summary: '删除诊所（软删除）' })
  remove(@Param('id') id: string) {
    return this.clinics.softDelete(id);
  }
}
