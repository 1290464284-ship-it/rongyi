import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Chair } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { ChairsService } from './chairs.service';
import { CreateChairDto, UpdateChairDto } from './dto/chair.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('牙椅管理')
@OperationLogResource('椅位')
@Controller('chairs')
export class ChairsController {
  constructor(private chairs: ChairsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findAll() { return this.chairs.findAll(); }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateChairDto) { return this.chairs.create(dto); }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChairDto) {
    return this.chairs.update(id, dto as unknown as Partial<Chair>);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) { return this.chairs.remove(id); }
}
