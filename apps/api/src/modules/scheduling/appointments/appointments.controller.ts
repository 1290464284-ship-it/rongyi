import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { ResourceOwner } from '../../../common/decorators/resource-owner.decorator';
import { ResourceOwnerGuard } from '../../../common/guards/resource-owner.guard';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';
import { Appointment } from '@dental/shared';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('预约管理')
@OperationLogResource('预约')
@Controller('appointments')
export class AppointmentsController {
  constructor(private appointments: AppointmentsService) {}

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateAppointmentDto) {
    return this.appointments.create(dto as Partial<Appointment>);
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryAppointmentDto) {
    return this.appointments.queryAppointments(q);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  @UseGuards(ResourceOwnerGuard)
  @ResourceOwner({ resourceType: 'Appointment' })
  findOne(@Param('id') id: string) {
    return this.appointments.findOne(id);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  @UseGuards(ResourceOwnerGuard)
  @ResourceOwner({ resourceType: 'Appointment' })
  update(@Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return this.appointments.update(id, dto as Partial<Appointment>);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  @UseGuards(ResourceOwnerGuard)
  @ResourceOwner({ resourceType: 'Appointment' })
  remove(@Param('id') id: string) {
    return this.appointments.remove(id);
  }
}
