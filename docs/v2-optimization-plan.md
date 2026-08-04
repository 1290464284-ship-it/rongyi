# V2 一次性优化计划

## 当前基线

- server/domain 覆盖率：100%
- Web 核心文件覆盖率：statements 82.67%、lines 88.46%
- 测试：30 个测试文件、175 个测试
- 门禁：typecheck、lint、knip、build、electron compile、security scan、license check 全部通过
- 验证：API/UI/load smoke、package verification 通过

## 评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| 架构与模块化 | 8.0 | 分层清晰，大文件和 legacy 双模式仍需收敛 |
| 安全 | 7.5 | 权限、关系校验已加强，仍可继续收紧公开端点与存储 |
| 数据完整性 | 8.0 | 财务、软删除、唯一约束已加固，外键和会员卡链路待补 |
| 性能 | 6.5 | 索引已补，搜索和大型导入仍可优化 |
| 测试质量 | 7.5 | server 全覆盖，Web 覆盖率需要继续提升 |
| 可维护性 | 7.0 | 资源注册表和旧版生成资源仍有治理成本 |
| UX/UI | 6.0 | 角色导航和交互状态需要完善 |
| 运维与发布 | 7.5 | CI 与包验证完整，安装/升级验证需纳入常态 |
| 文档与治理 | 7.0 | 架构和迁移文档仍需补齐 |

## 执行顺序

1. 数据模型：Charge 记录 `memberCardId`，退款按原卡归还。
2. 幂等：处理中记录超过 30 分钟后允许重试。
3. 权限：API 默认拒绝，前端导航由服务端权限驱动。
4. 限流：refresh、sync、backup、bulk-import、财务/库存写操作增加速率限制。
5. 测试：Web 核心页面覆盖创建、编辑、删除、分页和只读状态。
6. 治理：增加资源写策略和 tenant 扫描架构测试。
7. 验证：完整 verify、smoke、package 后提交。

## 已完成

- Charge 记录实际使用的会员卡，退款优先按原卡归还。
- Idempotency 处理中记录超过 30 分钟后自动清理并允许重试。
- 新增 `/api/v2/auth/navigation`，前端按角色隐藏导航。
- refresh、sync、backup、bulk-import、财务/库存写操作增加限流。
- Web 核心页面补齐创建、编辑、删除、分页、枚举/关系/JSON 表单测试。
- 增加通用 CRUD 写策略和裸 `clinicId = ?` 架构扫描测试。

## 后续建议

- 搜索量达到十万行级别后引入 FTS5。
- 大型 legacy 数据库迁移改为事务分片。
- Web 覆盖率目标提升到 statements/lines 80%。
- 安装器、升级器、备份恢复进入 CI 常态验证。
