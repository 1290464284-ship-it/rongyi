import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { FirstExamsService } from './first-exams.service';
import { CreateFirstExamDto, CreateFollowUpDto } from './dto/create-first-exam.dto';
import { UpdateFirstExamDto } from './dto/update-first-exam.dto';
import { QueryFirstExamDto } from './dto/query-first-exam.dto';
import { ToothDiseaseDto } from './dto/tooth-disease.dto';
import { UpdateTrackDto } from './dto/update-track.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('初诊检查')
@OperationLogResource('初诊')
@Controller('first-exams')
export class FirstExamsController {
  constructor(private firstExamsService: FirstExamsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryFirstExamDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.firstExamsService.findMany({
      filters: { patientId: q.patientId, status: q.status },
      page: safePage(page),
      pageSize: safePageSize(pageSize, 50),
    });
  }

  @ApiOperation({ summary: 'stats - 初诊' })
  @Get('stats')
  stats() {
    return this.firstExamsService.stats();
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.firstExamsService.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateFirstExamDto) {
    return this.firstExamsService.create(dto);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFirstExamDto) {
    return this.firstExamsService.update(id, dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.firstExamsService.remove(id);
  }

  @ApiOperation({ summary: 'restart - 初诊' })
  @Post(':id/restart')
  restart(@Param('id') id: string) {
    return this.firstExamsService.restart(id);
  }

  @ApiOperation({ summary: 'complete - 初诊' })
  @Post(':id/complete')
  complete(@Param('id') id: string) {
    return this.firstExamsService.complete(id);
  }

  @ApiOperation({ summary: '获取初诊' })
  @Get(':id/teeth')
  getTeeth(@Param('id') id: string) {
    return this.firstExamsService.getTeeth(id);
  }

  @ApiOperation({ summary: '更新初诊' })
  @Patch(':id/teeth/:toothId')
  updateTooth(@Param('id') id: string, @Param('toothId') toothId: string, @Body() dto: Partial<ToothDiseaseDto>) {
    return this.firstExamsService.updateTooth(id, Number(toothId), dto);
  }

  @ApiOperation({ summary: '批量更新初诊牙齿' })
  @Patch(':id/teeth')
  batchUpdateTeeth(@Param('id') id: string, @Body() teeth: ToothDiseaseDto[]) {
    return this.firstExamsService.batchUpdateTeeth(id, teeth);
  }

  @ApiOperation({ summary: '查询初诊列表' })
  @Get('tracks/list')
  listTracks(@Query('examId') examId: string) {
    return this.firstExamsService.listTracks(examId);
  }

  @ApiOperation({ summary: '获取初诊' })
  @Get('tracks/:id')
  getTrack(@Param('id') id: string) {
    return this.firstExamsService.getTrack(id);
  }

  @ApiOperation({ summary: '更新初诊追踪' })
  @Patch('tracks/:id')
  updateTrack(@Param('id') id: string, @Body() dto: UpdateTrackDto) {
    return this.firstExamsService.updateTrack(id, dto);
  }

  @ApiOperation({ summary: '创建初诊' })
  @Post('tracks/:id/follow-up')
  createFollowUp(@Param('id') id: string, @Body() dto: CreateFollowUpDto) {
    return this.firstExamsService.createFollowUp(id, dto);
  }
}
