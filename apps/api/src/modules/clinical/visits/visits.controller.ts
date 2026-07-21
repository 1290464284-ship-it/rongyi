import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Visit } from '@dental/shared';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { QueryVisitDto } from './dto/query-visit.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('就诊管理')
@Controller('visits')
export class VisitsController {
  constructor(private visits: VisitsService) {}

  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto as unknown as Partial<Visit>);
  }

  @Get()
  findMany(@Query() q: QueryVisitDto) {
    return this.visits.findMany(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findOne(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteVisitDto) {
    return this.visits.complete(id, dto);
  }
}
