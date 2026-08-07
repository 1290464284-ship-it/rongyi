# 交付证据 — 阶段 2 审计修复（可维护性偿债）

**日期**: 2026-08-03 16:00
**影响级别**: High（跨模块重构，25 文件，无 DB/依赖变更）
**提交范围**: 64bead1..6c8f3ee（5 个提交）

## 变更摘要

| 提交 | 说明 | 文件数 |
|------|------|--------|
| 64bead1 | TreatmentProgressPage 拆分（1119→576行） | 3 |
| 877112d | HrPage 拆分（957→402行） | 3 |
| af9c8cf | BulkImport/BusinessAlert/Satisfaction/PrintPreview 拆分 + lint 清理 | 17 |
| 8b217db | N+1 修复 / ESLint 规则恢复 / a11y label 修复 | 6 |
| 6c8f3ee | 文档合并收敛（CLAUDE.md→AGENTS.md） | 3 |

**总计**: 25 files changed, +2372 / -2863 lines

## 验证门禁

| 门禁 | 状态 | 详情 |
|------|------|------|
| typecheck | ✅ | API + Web + Electron tsc --noEmit 通过 |
| lint:strict | ✅ | --max-warnings 0，0 warnings |
| shared test | ✅ | 全部通过 |
| arch:check | ✅ | 3 个警告（误报：多行 SQL 中 deletedAt IS NULL 已存在） |
| API test | ✅ | 86 tests passed |
| migration test | ✅ | 9 tests passed |
| web test | ✅ | 73 files, 438 tests passed |
| 豁免注册表 | ✅ | 17 条引用有效 |
| 文档新鲜度 | ✅ | 通过 |
| build | ✅ | shared + api + web 构建成功 |
| web 覆盖率 | ✅ | Statements 41.64%, Lines 43.01% |

## 变更类型

- **重构**: 6 个巨型页面组件拆分为独立子组件（TreatmentProgress/Hr/BulkImport/BusinessAlert/Satisfaction/PrintPreview）
- **性能**: follow-up-recommender batchGenerate 全表加载改 SQL 聚合 + deletedAt 过滤
- **质量**: ESLint 恢复 sonarjs/no-skipped-tests + no-incomplete-assertions；清理过时 strictNullChecks TODO
- **a11y**: 6 处 label 补 htmlFor/id（ImportOptions/CephalometricCanvas/CompareView/SettingsPage）
- **文档**: CLAUDE.md 与 AGENTS.md 内容合并，消除重叠

## 风险评估

- **无 DB 变更**: 不涉及 migration 或 schema 修改
- **无依赖变更**: 未添加/删除任何 npm 包
- **无 API 接口变更**: 纯前端重构 + 后端内部优化
- **向后兼容**: 所有组件接口保持不变，仅内部结构拆分

## 交付审查

**结论：通过**

- 11 条架构规则逐项合规
- 无阻塞项
- 1 个建议项：BadSurveyTable.tsx 泛型一致性改进（非阻塞，后续迭代处理）
- arch:check 3 个警告已确认为误报（多行 SQL 中 deletedAt IS NULL 存在但脚本正则未识别）
- 验证门禁全绿：typecheck + lint:strict + 438 tests + build + 豁免注册表 + 文档新鲜度
