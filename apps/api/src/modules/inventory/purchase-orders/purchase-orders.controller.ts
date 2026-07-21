import {
  Body,
  Controller,
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
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS)
@ApiTags('采购订单')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private purchaseOrders: PurchaseOrdersService) {}

  @Get()
  findMany(@Query() q: QueryPurchaseOrderDto) {
    return this.purchaseOrders.findMany(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrders.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto, @Request() req: ExpressRequest) {
    return this.purchaseOrders.create(dto, req.user);
  }

  @Patch(':id/receive')
  receive(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.purchaseOrders.receive(id, req.user);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.purchaseOrders.cancel(id);
  }
}
