import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { InventoryItem } from '@dental/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { QueryInventoryItemDto } from './dto/query-inventory-item.dto';
import { StockActionDto } from './dto/stock-action.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.RECEPTIONIST)
@ApiTags('库存管理')
@Controller('inventory')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @Get('items')
  findItems(@Query() q: QueryInventoryItemDto) {
    return this.inventory.findMany({
      keyword: q.keyword,
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 20,
      filters: { category: q.category },
    });
  }

  @Get('items/low-stock')
  findLowStockItems() {
    return this.inventory.findLowStockItems();
  }

  @Get('items/:id')
  findOneItem(@Param('id') id: string) {
    return this.inventory.findOne(id);
  }

  @Post('items')
  createItem(@Body() dto: CreateInventoryItemDto) {
    return this.inventory.create(dto as unknown as Partial<InventoryItem>);
  }

  @Patch('items/:id')
  updateItem(@Param('id') id: string, @Body() dto: Partial<CreateInventoryItemDto>) {
    return this.inventory.update(id, dto as unknown as Partial<InventoryItem>);
  }

  @Delete('items/:id')
  deleteItem(@Param('id') id: string) {
    return this.inventory.softDelete(id);
  }

  @Get('transactions')
  findTransactions(
    @Query('itemId') itemId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.inventory.findTransactions(itemId);
  }

  @Post('transactions')
  stockAction(@Body() dto: StockActionDto, @Request() req: ExpressRequest) {
    return this.inventory.stockAction({ ...dto, operatorId: req.user?.id, operatorName: req.user?.name });
  }
}
