import { Body, Controller, Delete, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { IsString, MaxLength } from 'class-validator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { SettingsService } from './settings.service';

/**
 * DTO for single setting update.
 * Security: validates value is a bounded string to prevent
 * unbounded payload sizes and type confusion (was inline type).
 */
export class UpdateSettingDto {
  @ApiProperty({ description: '设置项的值', example: '30' })
  @IsString()
  @MaxLength(2000)
  value!: string;
}

/**
 * DTO for batch setting upsert.
 * Security: validates the body is an object; key/value constraints
 * are enforced defensively in SettingsService.upsertMany.
 */
export class UpsertSettingsDto {
  [key: string]: string;
}

@Roles(Role.BOSS)
@ApiTags('系统设置')
@OperationLogResource('设置')
@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findAll() {
    return this.settings.findAll();
  }

  @ApiOperation({ summary: '按条件查询设置' })
  @Get(':key')
  async getByKey(@Param('key') key: string) {
    const value = await this.settings.get(key);
    return { key, value };
  }

  /**
   * 使用 PUT 而非 PATCH：因为这是对单个配置项的完整替换
   * 语义上是对指定 key 的完整 upsert 操作
   */
  @ApiOperation({ summary: '更新' })
  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.settings.updateClinicInfo(key, dto.value);
  }

  @ApiOperation({ summary: 'upsertMany - 设置' })
  @Patch()
  upsertMany(@Body() dto: UpsertSettingsDto) {
    return this.settings.upsertMany(dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':key')
  delete(@Param('key') key: string) {
    return this.settings.delete(key);
  }
}
