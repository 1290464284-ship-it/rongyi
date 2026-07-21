import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { Chair } from '@dental/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ChairsService } from './chairs.service';
import { CreateChairDto, UpdateChairDto } from './dto/chair.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('牙椅管理')
@Controller('chairs')
export class ChairsController {
  constructor(private chairs: ChairsService) {}

  @Get()
  findAll() { return this.chairs.findAll(); }

  @Post()
  create(@Body() dto: CreateChairDto) { return this.chairs.create(dto as unknown as Partial<Chair>); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChairDto) {
    return this.chairs.update(id, dto as unknown as Partial<Chair>);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.chairs.remove(id); }
}
