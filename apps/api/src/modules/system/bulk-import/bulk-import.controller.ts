import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  BulkImportService,
  BulkImportResult,
} from './bulk-import.service';
import { PatientImportRow } from './validators/patient.validator';
import { DrugImportRow } from './validators/drug.validator';
import { InventoryImportRow } from './validators/inventory.validator';

interface ImportRequest<T> {
  rows: T[];
  dryRun?: boolean;
}

@Roles(Role.BOSS, Role.ADMIN)
@UseGuards(RolesGuard)
@ApiTags('批量导入')
@Controller('system/bulk-import')
export class BulkImportController {
  constructor(private bulkImportService: BulkImportService) {}

  @ApiOperation({ summary: '批量导入患者' })
  @Post('patients')
  importPatients(
    @Body() body: ImportRequest<PatientImportRow>,
    @CurrentUser() user: { id?: string },
  ): Promise<BulkImportResult> {
    return this.bulkImportService.importPatients(body.rows || [], {
      dryRun: body.dryRun ?? false,
      createdById: user?.id,
    });
  }

  @ApiOperation({ summary: '批量导入药品目录' })
  @Post('drug-catalog')
  importDrugCatalog(
    @Body() body: ImportRequest<DrugImportRow>,
    @CurrentUser() user: { id?: string },
  ): Promise<BulkImportResult> {
    return this.bulkImportService.importDrugCatalog(body.rows || [], {
      dryRun: body.dryRun ?? false,
      createdById: user?.id,
    });
  }

  @ApiOperation({ summary: '批量导入库存' })
  @Post('inventory')
  importInventory(
    @Body() body: ImportRequest<InventoryImportRow>,
    @CurrentUser() user: { id?: string },
  ): Promise<BulkImportResult> {
    return this.bulkImportService.importInventory(body.rows || [], {
      dryRun: body.dryRun ?? false,
      createdById: user?.id,
    });
  }

  @ApiOperation({ summary: '获取导入模板（列定义 + 示例行）' })
  @Get('template')
  getTemplate(
    @Query('type') type: 'patient' | 'drug' | 'inventory',
  ) {
    return this.bulkImportService.getImportTemplate(type);
  }
}
