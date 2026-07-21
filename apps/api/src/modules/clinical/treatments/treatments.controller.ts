import {
  Body,
  Controller,
  Delete,
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
import { Treatment } from '@dental/shared';
import { TreatmentsService } from './treatments.service';
import { CreateTreatmentDto } from './dto/create-treatment.dto';
import { UpdateTreatmentDto } from './dto/update-treatment.dto';
import { QueryTreatmentDto } from './dto/query-treatment.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('治疗记录')
@Controller('treatments')
export class TreatmentsController {
  constructor(private treatments: TreatmentsService) {}

  @Get('catalog')
  findCatalog() {
    return this.treatments.findCatalog();
  }

  @Post('catalog')
  createCatalog(@Body() body: { code: string; name: string; category: string; price: number; remark?: string }) {
    return this.treatments.createCatalog(body);
  }

  @Patch('catalog/:id')
  updateCatalog(@Param('id') id: string, @Body() body: any) {
    return this.treatments.updateCatalog(id, body);
  }

  @Delete('catalog/:id')
  deleteCatalog(@Param('id') id: string) {
    return this.treatments.deleteCatalog(id);
  }

  @Post()
  create(@Body() dto: CreateTreatmentDto) {
    return this.treatments.create(dto as unknown as Partial<Treatment>);
  }

  @Get()
  findMany(@Query() q: QueryTreatmentDto) {
    return this.treatments.findMany(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.treatments.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTreatmentDto) {
    return this.treatments.update(id, dto as unknown as Partial<Treatment>);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.treatments.remove(id);
  }
}
