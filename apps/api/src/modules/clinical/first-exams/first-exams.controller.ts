import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { FirstExamsService } from './first-exams.service';
import { CreateFirstExamDto } from './dto/create-first-exam.dto';
import { UpdateFirstExamDto } from './dto/update-first-exam.dto';
import { QueryFirstExamDto } from './dto/query-first-exam.dto';
import { ToothDiseaseDto } from './dto/tooth-disease.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('初诊检查')
@Controller('first-exams')
export class FirstExamsController {
  constructor(private firstExamsService: FirstExamsService) {}

  @Get()
  findAll(@Query() q: QueryFirstExamDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.firstExamsService.findMany({ ...q, page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @Get('stats')
  stats() {
    return this.firstExamsService.stats();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.firstExamsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFirstExamDto) {
    return this.firstExamsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFirstExamDto) {
    return this.firstExamsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.firstExamsService.remove(id);
  }

  @Post(':id/restart')
  restart(@Param('id') id: string) {
    return this.firstExamsService.restart(id);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    return this.firstExamsService.complete(id);
  }

  @Get(':id/teeth')
  getTeeth(@Param('id') id: string) {
    return this.firstExamsService.getTeeth(id);
  }

  @Patch(':id/teeth/:toothId')
  updateTooth(@Param('id') id: string, @Param('toothId') toothId: string, @Body() dto: Partial<ToothDiseaseDto>) {
    return this.firstExamsService.updateTooth(id, Number(toothId), dto);
  }

  @Put(':id/teeth')
  batchUpdateTeeth(@Param('id') id: string, @Body() teeth: ToothDiseaseDto[]) {
    return this.firstExamsService.batchUpdateTeeth(id, teeth);
  }

  @Get('tracks/list')
  listTracks(@Query('examId') examId: string) {
    return this.firstExamsService.listTracks(examId);
  }

  @Get('tracks/:id')
  getTrack(@Param('id') id: string) {
    return this.firstExamsService.getTrack(id);
  }

  @Patch('tracks/:id')
  updateTrack(@Param('id') id: string, @Body() dto: {
    status?: string;
    leaderSuggestion?: string;
    directorSuggestion?: string;
    churnReason?: string;
    churnSolution?: string;
  }) {
    return this.firstExamsService.updateTrack(id, dto);
  }

  @Post('tracks/:id/follow-up')
  createFollowUp(@Param('id') id: string, @Body() dto: { planDate: string; content?: string; assigneeId?: string }) {
    return this.firstExamsService.createFollowUp(id, dto);
  }
}
