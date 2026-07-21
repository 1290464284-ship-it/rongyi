import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ToothRecordsService } from './tooth-records.service';
import { UpsertToothDto } from './dto/upsert-tooth.dto';
import { QueryToothDto } from './dto/query-tooth.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('牙位记录')
@Controller('tooth-records')
export class ToothRecordsController {
  constructor(private teeth: ToothRecordsService) {}

  @Get()
  findMany(@Query() q: QueryToothDto) {
    return this.teeth.findByPatient(q.patientId);
  }

  @Get(':toothNumber')
  findOne(@Query('patientId') patientId: string, @Param('toothNumber') toothNumber: number) {
    return this.teeth.findOne(patientId, Number(toothNumber));
  }

  @Post()
  upsert(@Body() dto: UpsertToothDto) {
    return this.teeth.upsert(dto.patientId, dto.toothNumber, dto);
  }

  @Delete(':toothNumber')
  remove(@Query('patientId') patientId: string, @Param('toothNumber') toothNumber: number) {
    return this.teeth.remove(patientId, Number(toothNumber));
  }
}
