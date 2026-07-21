import { Controller, Post, Get, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { Prescription } from '@dental/shared';
import { PrescriptionsService } from './prescriptions.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { QueryPrescriptionDto } from './dto/query-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';

@ApiTags('处方管理')
@Controller('prescriptions')
@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
export class PrescriptionsController {
  constructor(private prescriptions: PrescriptionsService) {}

  @Post()
  create(@Body() dto: CreatePrescriptionDto) {
    return this.prescriptions.create(dto as unknown as Partial<Prescription>);
  }

  @Get()
  findMany(@Query() dto: QueryPrescriptionDto) {
    return this.prescriptions.findMany(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prescriptions.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePrescriptionDto) {
    return this.prescriptions.update(id, dto as unknown as Partial<Prescription>);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prescriptions.remove(id);
  }
}
