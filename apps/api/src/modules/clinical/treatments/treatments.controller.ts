import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { Treatment } from '@dental/shared';
import { TreatmentsService } from './treatments.service';
import { CreateTreatmentDto, CreateTreatmentCatalogDto, UpdateTreatmentCatalogDto } from './dto/create-treatment.dto';
import { UpdateTreatmentDto } from './dto/update-treatment.dto';
import { QueryTreatmentDto } from './dto/query-treatment.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('治疗记录')
@OperationLogResource('治疗')
@Controller('treatments')
export class TreatmentsController {
  constructor(private treatments: TreatmentsService) {}

  @ApiOperation({ summary: '获取治疗' })
  @Get('catalog')
  findCatalog() {
    return this.treatments.findCatalog();
  }

  @ApiOperation({ summary: '创建治疗' })
  @Post('catalog')
  createCatalog(@Body() dto: CreateTreatmentCatalogDto) {
    return this.treatments.createCatalog(dto);
  }

  @ApiOperation({ summary: '更新治疗' })
  @Patch('catalog/:id')
  updateCatalog(@Param('id') id: string, @Body() dto: UpdateTreatmentCatalogDto) {
    return this.treatments.updateCatalog(id, dto);
  }

  @ApiOperation({ summary: '删除治疗' })
  @Delete('catalog/:id')
  deleteCatalog(@Param('id') id: string) {
    return this.treatments.deleteCatalog(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateTreatmentDto) {
    return this.treatments.create(dto as unknown as Partial<Treatment>);
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryTreatmentDto) {
    return this.treatments.findMany(q);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.treatments.findOne(id);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTreatmentDto) {
    return this.treatments.update(id, dto as unknown as Partial<Treatment>);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.treatments.remove(id);
  }
}
