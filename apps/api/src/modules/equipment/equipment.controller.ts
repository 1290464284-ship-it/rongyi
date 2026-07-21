import { safePage, safePageSize } from '../../common/dto/pagination.dto';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/types/enums';
import { Equipment } from '@dental/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { EquipmentService } from './equipment.service';
import { CreateEquipmentDto, UpdateEquipmentDto, QueryEquipmentDto } from './dto/equipment.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS)
@ApiTags('设备管理')
@Controller('equipment')
export class EquipmentController {
  constructor(private equipment: EquipmentService) {}

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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.equipment.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateEquipmentDto) {
    return this.equipment.create(dto as unknown as Partial<Equipment>);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEquipmentDto) {
    return this.equipment.update(id, dto as unknown as Partial<Equipment>);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.equipment.remove(id);
  }
}
