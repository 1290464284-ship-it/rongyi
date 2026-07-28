import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { InventoryItem } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { QueryInventoryItemDto } from './dto/query-inventory-item.dto';
import { StockActionDto } from './dto/stock-action.dto';

@Roles(Role.BOSS, Role.RECEPTIONIST)
@ApiTags('库存管理')
@OperationLogResource('库存')
@Controller('inventory')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @ApiOperation({ summary: '获取库存' })
  @Get('items')
  findItems(@Query() q: QueryInventoryItemDto) {
    return this.inventory.findMany({
      keyword: q.keyword,
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 20,
      filters: { category: q.category },
    });
  }

  @ApiOperation({ summary: '获取库存' })
  @Get('items/low-stock')
  findLowStockItems() {
    return this.inventory.findLowStockItems();
  }

  @ApiOperation({ summary: '获取库存详情' })
  @Get('items/:id')
  findOneItem(@Param('id') id: string) {
    return this.inventory.findOne(id);
  }

  @ApiOperation({ summary: '创建库存' })
  @Post('items')
  createItem(@Body() dto: CreateInventoryItemDto) {
    return this.inventory.create(dto as unknown as Partial<InventoryItem>);
  }

  @ApiOperation({ summary: '更新库存' })
  @Patch('items/:id')
  updateItem(@Param('id') id: string, @Body() dto: Partial<CreateInventoryItemDto>) {
    return this.inventory.update(id, dto);
  }

  @ApiOperation({ summary: '删除库存' })
  @Delete('items/:id')
  deleteItem(@Param('id') id: string) {
    return this.inventory.softDelete(id);
  }

  @ApiOperation({ summary: '获取库存' })
  @Get('transactions')
  findTransactions(
    @Query('itemId') itemId?: string,
    @Query('page') _page?: string,
    @Query('pageSize') _pageSize?: string,
  ) {
    return this.inventory.findTransactions(itemId);
  }

  @ApiOperation({ summary: 'stockAction - 库存' })
  @Post('transactions')
  stockAction(@Body() dto: StockActionDto, @Request() req: ExpressRequest) {
    return this.inventory.stockAction({ ...dto, operatorId: req.user?.id, operatorName: req.user?.name });
  }
}
