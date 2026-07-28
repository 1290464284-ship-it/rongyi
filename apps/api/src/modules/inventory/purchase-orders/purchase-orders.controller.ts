import { Body, Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';

@Roles(Role.BOSS)
@ApiTags('采购订单')
@OperationLogResource('采购单')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private purchaseOrders: PurchaseOrdersService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryPurchaseOrderDto) {
    return this.purchaseOrders.findMany(q);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrders.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreatePurchaseOrderDto, @Request() req: ExpressRequest) {
    return this.purchaseOrders.createOrder(dto, req.user);
  }

  @ApiOperation({ summary: 'receive - 采购订单' })
  @Patch(':id/receive')
  receive(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.purchaseOrders.receive(id, req.user);
  }

  @ApiOperation({ summary: '取消预约' })
  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.purchaseOrders.cancel(id);
  }
}
