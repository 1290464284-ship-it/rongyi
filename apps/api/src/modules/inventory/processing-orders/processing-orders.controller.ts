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
  } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { ProcessingOrdersService } from './processing-orders.service';
import { CreateFactoryDto, UpdateFactoryDto } from './dto/factory.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { CreateProcessingOrderDto } from './dto/create-processing-order.dto';
import { UpdateProcessingOrderDto, UpdateStatusDto, AddFlowLogDto, LinkChargeDto } from './dto/update-processing-order.dto';
import { QueryProcessingOrderDto } from './dto/query-processing-order.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('加工订单')
@OperationLogResource('加工单')
@Controller('processing-orders')
export class ProcessingOrdersController {
  constructor(private processingOrders: ProcessingOrdersService) {}

  @ApiOperation({ summary: '查询加工单列表' })
  @Get('factories')
  listFactories() {
    return this.processingOrders.listFactories();
  }

  @ApiOperation({ summary: '创建加工单' })
  @Post('factories')
  createFactory(@Body() dto: CreateFactoryDto) {
    return this.processingOrders.createFactory(dto);
  }

  @ApiOperation({ summary: '更新加工单' })
  @Patch('factories/:id')
  updateFactory(@Param('id') id: string, @Body() dto: UpdateFactoryDto) {
    return this.processingOrders.updateFactory(id, dto);
  }

  @ApiOperation({ summary: '删除加工单' })
  @Delete('factories/:id')
  deleteFactory(@Param('id') id: string) {
    return this.processingOrders.deleteFactory(id);
  }

  @ApiOperation({ summary: '查询加工单列表' })
  @Get('products')
  listAllProducts(@Query('factoryId') factoryId?: string) {
    return this.processingOrders.listProducts(factoryId);
  }

  @ApiOperation({ summary: '查询加工单列表' })
  @Get('factories/:factoryId/products')
  listProducts(@Param('factoryId') factoryId: string) {
    return this.processingOrders.listProducts(factoryId);
  }

  @ApiOperation({ summary: '创建加工单' })
  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.processingOrders.createProduct(dto);
  }

  @ApiOperation({ summary: '更新加工单' })
  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.processingOrders.updateProduct(id, dto);
  }

  @ApiOperation({ summary: '删除加工单' })
  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.processingOrders.deleteProduct(id);
  }

  @ApiOperation({ summary: 'stats - 加工单' })
  @Get('stats')
  stats() {
    return this.processingOrders.stats();
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findAll(@Query() q: QueryProcessingOrderDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.processingOrders.findMany({ ...q, page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.processingOrders.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateProcessingOrderDto) {
    return this.processingOrders.create(dto);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProcessingOrderDto) {
    return this.processingOrders.update(id, dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.processingOrders.remove(id);
  }

  @ApiOperation({ summary: '更新加工单' })
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.processingOrders.updateStatus(id, dto.status);
  }

  @ApiOperation({ summary: '创建加工单' })
  @Post(':id/flow-logs')
  addFlowLog(@Param('id') id: string, @Body() dto: AddFlowLogDto) {
    return this.processingOrders.addFlowLog(id, dto);
  }

  @ApiOperation({ summary: 'linkCharge - 加工单' })
  @Patch(':id/link-charge')
  linkCharge(@Param('id') id: string, @Body() dto: LinkChargeDto) {
    return this.processingOrders.linkCharge(id, dto.chargeId);
  }
}
