import { safePage, safePageSize } from '../../common/dto/pagination.dto';
import { Body, Controller, Delete, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Equipment } from '@dental/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../common/decorators/operation-log-resource.decorator';
import { EquipmentService } from './equipment.service';
import { CreateEquipmentDto, UpdateEquipmentDto, QueryEquipmentDto } from './dto/equipment.dto';

@Roles(Role.BOSS)
@ApiTags('设备管理')
@OperationLogResource('设备')
@Controller('equipment')
export class EquipmentController {
  constructor(private equipment: EquipmentService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(
    @Query() q: QueryEquipmentDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.equipment.findMany({
      keyword: q.keyword || q.name,
      page: safePage(page),
      pageSize: safePageSize(pageSize, 20),
    });
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.equipment.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateEquipmentDto) {
    return this.equipment.create(dto as Partial<Equipment>);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEquipmentDto) {
    return this.equipment.update(id, dto as Partial<Equipment>);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.equipment.remove(id);
  }
}
