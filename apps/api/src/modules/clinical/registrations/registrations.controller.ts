import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role, Registration } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { RegistrationsService } from './registrations.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { UpdateRegistrationDto } from './dto/update-registration.dto';
import { QueryRegistrationDto } from './dto/query-registration.dto';
import { TriageRegistrationDto } from './dto/triage-registration.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('挂号登记')
@OperationLogResource('挂号')
@Controller('registrations')
export class RegistrationsController {
  constructor(private registrations: RegistrationsService) {}

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateRegistrationDto) {
    return this.registrations.create(dto as Partial<Registration>);
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findAll(@Query() q: QueryRegistrationDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.registrations.findMany({ ...q, page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.registrations.findOne(id);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRegistrationDto) {
    return this.registrations.update(id, dto);
  }

  @ApiOperation({ summary: 'triage - 挂号' })
  @Patch(':id/triage')
  triage(@Param('id') id: string, @Body() dto: TriageRegistrationDto) {
    return this.registrations.triage(id, dto);
  }

  @ApiOperation({ summary: '开始接诊' })
  @Patch(':id/start-visit')
  startVisit(@Param('id') id: string) {
    return this.registrations.startVisit(id);
  }

  @ApiOperation({ summary: 'complete - 挂号' })
  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.registrations.complete(id);
  }

  @ApiOperation({ summary: '取消预约' })
  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.registrations.cancel(id);
  }
}
