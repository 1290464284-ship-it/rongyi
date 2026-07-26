import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { CodeGenerator } from './code-generator.service';
import { SoftDeleteManager } from './soft-delete-manager.service';
import { BaseRepository } from '../repositories/base.repository';

/**
 * Common Services Module - 注册从 BaseService 上帝类拆分出的协作服务
 *
 * 设计说明：
 *  1. 这些服务（AuditLogService / CodeGenerator / SoftDeleteManager / BaseRepository）
 *     均为无状态服务，方法签名接收所有必要参数，不依赖任何内部可变状态。
 *  2. BaseService 当前通过"内部实例化"策略使用这些服务（构造函数内 new），
 *     原因是 BaseService 是抽象基类，若改为 Nest DI 注入需修改 28 个子类的
 *     super(dbService, clinicContext, ...) 调用，重构风险过大。
 *  3. 将这些服务注册到 Nest DI 容器中，目的有二：
 *     - 让未来其他需要审计 / 编码生成 / 软删除 / SQL 操作的服务可以直接通过 DI 复用
 *     - 为后续将 BaseService 改造为 DI 注入模式铺路（可分阶段渐进式迁移子类）
 *  4. 不在本 Module 中导入 DbModule / CommonModule，因为这些服务的方法签名
 *     显式接收 DbService / clinicContext 等依赖，不通过构造函数注入。
 */
@Module({
  providers: [
    AuditLogService,
    CodeGenerator,
    SoftDeleteManager,
    BaseRepository,
  ],
  exports: [
    AuditLogService,
    CodeGenerator,
    SoftDeleteManager,
    BaseRepository,
  ],
})
export class CommonServicesModule {}
