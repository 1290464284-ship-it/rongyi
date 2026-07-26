import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { Imaging } from '@dental/shared';
import { ImagingService } from './imaging.service';
import { CreateImagingDto, UpdateImagingDto, QueryImagingDto } from './dto/imaging.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('影像管理')
@OperationLogResource('影像')
@Controller('imaging')
export class ImagingController {
  constructor(private imaging: ImagingService) {}

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateImagingDto) {
    return this.imaging.create(dto as unknown as Partial<Imaging>);
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryImagingDto) {
    return this.imaging.findMany(q);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.imaging.findOne(id);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateImagingDto) {
    return this.imaging.update(id, dto as unknown as Partial<Imaging>);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.imaging.remove(id);
  }
}
