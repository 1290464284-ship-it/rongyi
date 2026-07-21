import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OralExamination } from './oral-examinations.service';
import { OralExaminationsService } from './oral-examinations.service';
import { CreateOralExaminationDto } from './dto/create-oral-examination.dto';
import { QueryOralExaminationDto } from './dto/query-oral-examination.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('口腔检查')
@Controller('oral-examinations')
export class OralExaminationsController {
  constructor(private exams: OralExaminationsService) {}

  @Get()
  findMany(@Query() q: QueryOralExaminationDto) {
    return this.exams.findMany({ filters: { patientId: q.patientId, visitId: q.visitId } });
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.exams.findOne(id); }

  @Post()
  create(@Body() dto: CreateOralExaminationDto) { return this.exams.create(dto as unknown as Partial<OralExamination>); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateOralExaminationDto>) { return this.exams.update(id, dto as unknown as Partial<OralExamination>); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.exams.remove(id); }
}
