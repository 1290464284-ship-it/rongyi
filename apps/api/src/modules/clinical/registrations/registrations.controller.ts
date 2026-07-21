import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RegistrationsService } from './registrations.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { UpdateRegistrationDto } from './dto/update-registration.dto';
import { QueryRegistrationDto } from './dto/query-registration.dto';
import { TriageRegistrationDto } from './dto/triage-registration.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('挂号登记')
@Controller('registrations')
export class RegistrationsController {
  constructor(private registrations: RegistrationsService) {}

  @Post()
  create(@Body() dto: CreateRegistrationDto) {
    return this.registrations.create(dto);
  }

  @Get()
  findAll(@Query() q: QueryRegistrationDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.registrations.findMany({ ...q, page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.registrations.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRegistrationDto) {
    return this.registrations.update(id, dto);
  }

  @Patch(':id/triage')
  triage(@Param('id') id: string, @Body() dto: TriageRegistrationDto) {
    return this.registrations.triage(id, dto);
  }

  @Patch(':id/start-visit')
  startVisit(@Param('id') id: string) {
    return this.registrations.startVisit(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.registrations.complete(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.registrations.cancel(id);
  }
}
