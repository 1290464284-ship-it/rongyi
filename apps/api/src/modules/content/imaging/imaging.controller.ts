import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Role } from '../../../common/types/enums';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Imaging } from '@dental/shared';
import { ImagingService } from './imaging.service';
import { CreateImagingDto, UpdateImagingDto, QueryImagingDto } from './dto/imaging.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('影像管理')
@Controller('imaging')
export class ImagingController {
  constructor(private imaging: ImagingService) {}

  @Post()
  create(@Body() dto: CreateImagingDto) {
    return this.imaging.create(dto as unknown as Partial<Imaging>);
  }

  @Get()
  findMany(@Query() q: QueryImagingDto) {
    return this.imaging.findMany(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.imaging.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateImagingDto) {
    return this.imaging.update(id, dto as unknown as Partial<Imaging>);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.imaging.remove(id);
  }
}
