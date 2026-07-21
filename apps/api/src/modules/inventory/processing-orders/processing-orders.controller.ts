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
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ProcessingOrdersService } from './processing-orders.service';
import { CreateFactoryDto, UpdateFactoryDto, QueryFactoryDto } from './dto/factory.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { CreateProcessingOrderDto } from './dto/create-processing-order.dto';
import { UpdateProcessingOrderDto, UpdateStatusDto, AddFlowLogDto, LinkChargeDto } from './dto/update-processing-order.dto';
import { QueryProcessingOrderDto } from './dto/query-processing-order.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('加工订单')
@Controller('processing-orders')
export class ProcessingOrdersController {
  constructor(private processingOrders: ProcessingOrdersService) {}

  @Get('factories')
  listFactories() {
    return this.processingOrders.listFactories();
  }

  @Post('factories')
  createFactory(@Body() dto: CreateFactoryDto) {
    return this.processingOrders.createFactory(dto);
  }

  @Patch('factories/:id')
  updateFactory(@Param('id') id: string, @Body() dto: UpdateFactoryDto) {
    return this.processingOrders.updateFactory(id, dto);
  }

  @Delete('factories/:id')
  deleteFactory(@Param('id') id: string) {
    return this.processingOrders.deleteFactory(id);
  }

  @Get('products')
  listAllProducts(@Query('factoryId') factoryId?: string) {
    return this.processingOrders.listProducts(factoryId);
  }

  @Get('factories/:factoryId/products')
  listProducts(@Param('factoryId') factoryId: string) {
    return this.processingOrders.listProducts(factoryId);
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.processingOrders.createProduct(dto);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.processingOrders.updateProduct(id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.processingOrders.deleteProduct(id);
  }

  @Get('stats')
  stats() {
    return this.processingOrders.stats();
  }

  @Get()
  findAll(@Query() q: QueryProcessingOrderDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.processingOrders.findMany({ ...q, page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.processingOrders.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProcessingOrderDto) {
    return this.processingOrders.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProcessingOrderDto) {
    return this.processingOrders.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.processingOrders.remove(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.processingOrders.updateStatus(id, dto.status);
  }

  @Post(':id/flow-logs')
  addFlowLog(@Param('id') id: string, @Body() dto: AddFlowLogDto) {
    return this.processingOrders.addFlowLog(id, dto);
  }

  @Patch(':id/link-charge')
  linkCharge(@Param('id') id: string, @Body() dto: LinkChargeDto) {
    return this.processingOrders.linkCharge(id, dto.chargeId);
  }
}
