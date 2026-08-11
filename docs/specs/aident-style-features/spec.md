# 艾登特风格功能增强 - 产品需求文档 (PRD)

## Overview
- **Summary**: 参照艾登特（原艾坚）口腔管理软件的「传统算法智能辅助」路线（非深度学习），在现有系统基础上新增一批单人可维护、基于规则/统计/几何公式实现的智能辅助功能，覆盖正畸头影测量、智能结构化病历、本地AI辅助规则引擎、经营预警、排班考勤、满意度、数据导入、打印模板、离线加密等能力。
- **Purpose**: 提升诊所医生/前台日常操作效率、补齐行业软件标配的「智能辅助」体验，确保所有功能开发一次、后续维护成本接近零，符合单人维护的可操作性。
- **Target Users**: 单人维护开发者、中小型私立口腔诊所医生、前台、老板/管理者。

## Goals
- **G1 正畸头影测量**: 实现艾登特风格「医生手动关键点标注 + 软件自动几何计算 + 多方法正常值对比」的正畸分析基础能力。
- **G2 智能结构化病历**: 强化现有病历模板、短语、结构化字段的组合体验，增加诊断自动摘要、牙位状态联动、短语收藏夹等。
- **G3 本地规则型 AI 辅助**: 基于本地规则库/统计算法实现：处方配伍禁忌审核、患者风险评分、复诊时机推荐、收费项目智能补全（Apriori 关联规则）、经营异常检测、库存补货建议、RFM 客户分层标签、患者流失预测、医生业绩异常检测。
- **G4 经营运营辅助**: 疗程进度看板、客户满意度评价、排班考勤请假。
- **G5 数据与外设友好**: 数据 Excel/CSV 批量导入、病历/处方/收费/标签打印模板。
- **G6 桌面端与安全**: SQLite 离线加密存储、Electron 系统托盘最小化后台。

## Non-Goals (Out of Scope)
- ❌ 深度学习/神经网络自研影像AI（龋齿检测、CBCT分割等）
- ❌ 医保/社保对接
- ❌ 短信平台、电子签名/CA、绩效考核系统
- ❌ 原生移动端 APP、患者端微信小程序/公众号
- ❌ 儿牙、知情同意书、连锁多店、集团化
- ❌ 会员裂变营销、美团点评预约同步
- ❌ 内部通讯/通用审批流、培训平台、远程会诊、保险理赔
- ❌ DICOM 标准对接、硬件 SDK（内窥镜/CBCT/口扫）、硬件驱动
- ❌ 开机自启服务模式、多窗口独立、云盘自动备份
- ❌ 正畸/种植专科深度模块（只做头影测量这一个正畸通用工具）

## Background & Context
> **迁移说明（第三轮审计更新）**：以下路径均已迁移至 monorepo 的
> `apps/v2/`（Electron + 本地 SQLite + Express，无独立 apps/api、apps/web）。
现有代码基线能力评估：
1. **数据库 Schema 完备度高**：患者/预约/诊疗/收费/库存/处方/影像/回访/设备/统计十大模块已齐全（见 [apps/v2/src/server/infrastructure/database.ts](../../../apps/v2/src/server/infrastructure/database.ts) 与 [migrations.ts](../../../apps/v2/src/server/infrastructure/migrations/index.ts)）。
2. **已有基础设施可复用**：
   - 定时器机制：`startSchedulers` 已用 `setInterval` 实现 24h 自动备份/审计清理等周期任务（[apps/v2/src/server/scheduler.ts](../../../apps/v2/src/server/scheduler.ts)），可复用为每日 cron 调度器模式。
   - 审计日志/操作日志：避免新增功能跳过审计。
   - 软删除与诊所隔离：遵循现有 `tenantAnd`/`tenantParams` + `deletedAt` 模式（[apps/v2/src/server/infrastructure/tenant.ts](../../../apps/v2/src/server/infrastructure/tenant.ts)）。
3. **Electron 壳能力**：[apps/v2/electron/main.cjs](../../../apps/v2/electron/main.cjs) 已有窗口管理（createWindow/loadWindowState/saveWindowState），可扩展托盘。
4. **加密基础**：已有 [apps/v2/src/server/infrastructure/security.ts](../../../apps/v2/src/server/infrastructure/security.ts) 工具模块（备份库加密在 backup.ts 中）。

艾登特智能功能的技术路线分析（与博恩登特深度学习路线的关键区别）：
- 基于口腔医学教科书已有的**几何公式/正常值数据库/配伍禁忌表**硬编码。
- 基于诊所本地历史数据的**统计/排序/加权评分/规则引擎**。
- 不依赖 GPU、不依赖云端模型推理、不依赖外部标注数据集。
- 因此单人可维护、上线后基本无持续运维。

## Functional Requirements

### 一、正畸头影测量 (Cephalometric Analysis)
- **FR-1.1**: 影像关联头颅侧位片，前端提供画布手动点击 30 个标准解剖标志点（S/N/A/B/ANS/PNS/Go/Me/Co 等）。
- **FR-1.2**: 后端按 4 种主流测量方法（Tweed/McNamara/Steiner/Downs）内置公式库自动计算：SNA/SNB/ANB/FMA/IMPA/U1-NA/L1-NB 等 50+ 项线距、角度、比例。
- **FR-1.3**: 每项测量结果对照同种族同龄正常值数据库，自动标注「偏大/正常/偏小」并颜色区分。
- **FR-1.4**: 分析结果可保存为一条 CephalometricRecord，支持历史对比（两次测量结果差异高亮）。
- **FR-1.5**: 支持打印输出标准头影测量报告（A4）。

### 二、智能结构化病历增强
- **FR-2.1**: 病历自动摘要：保存病历后基于牙位变化+治疗项目+主诉字段自动生成 100 字以内的「本次就诊摘要」。
- **FR-2.2**: 医生个人短语收藏夹：MedicalPhrase 增加 ownerId 维度，默认显示「我的+全局」，个人置顶排序。
- **FR-2.3**: 牙位状态联动：在 ToothChart 上点选某颗牙后，自动填充病历里该牙的「诊断/治疗项目」下拉框。
- **FR-2.4**: 下次就诊一句话提醒：Visit 增加 nextReminder TEXT 字段，在就诊页头部显著显示。

### 三、本地 AI 辅助规则引擎（9 项子功能）
- **FR-3.1 处方配伍禁忌审核**：`DrugContraindication` 表内置 100 条口腔常用药禁忌组合（甲硝唑+酒精、双氯芬酸+华法林、两种 NSAID、孕期禁用等），处方保存时校验弹警告。
- **FR-3.2 患者风险评分**：基于牙位状态（龋齿数/缺牙数/牙周探诊深度）+ 年龄 + 就诊频率 + 吸烟/糖尿病系统病史，输出龋风险/牙周风险/种植体周围炎风险 3 项 0-100 分 + 等级（低/中/高/极高）。
- **FR-3.3 复诊时机推荐**：基于治疗项目类型（根管/拔牙/洁牙/种植二期/正畸复诊）+ 同项目历史平均复诊周期，给出「建议复诊日期」。
- **FR-3.4 收费项目智能补全**：用 Apriori 关联规则离线计算所有 Charge 中 item 组合的支持度与置信度（阈值可调），在收费界面选了前 2 项后自动推荐 Top3 共现高频项目（置信度>0.4）。算法：纯 SQL GROUP BY + 计数即可。
- **FR-3.5 经营异常预警**：每日cron计算本月营收同比上月/去年同月偏离度（|Δ|>20%标红）、患者新增数、预约爽约率、平均客单价，异常时写入告警表 + 仪表盘红条。
- **FR-3.6 库存补货建议**：基于最近 90 天消耗滑动平均 + 采购周期 + 安全库存系数（默认1.5），对每个库存品输出「建议采购量 N」，低于最低库存阈值的品标红。
- **FR-3.7 RFM 客户分层标签**：Recency(最近一次消费距今天数)、Frequency(90天消费次数)、Monetary(90天消费金额) 三项各 1-5 分，加总分自动打标签：重要价值/重要发展/重要保持/重要挽留/一般价值/流失客户，写入 Patient.tags。
- **FR-3.8 患者流失预测**：规则加权评分（距上次就诊天数×0.4 + 消费频率下降率×0.3 + 是否有欠费×0.3），>70分判定「高流失风险」，打标签+回访页优先。
- **FR-3.9 医生业绩异常检测**：按医生维度，近30日初诊数/营收/治疗完成率，与本人近90日均值比较，Z-score > ±2 判定异常，进入经营预警日志。实现：标准差法 + 箱线图四分位范围。

### 四、经营运营辅助
- **FR-4.1 疗程/治疗进度看板**：TreatmentPlan 聚合展示，卡片式每个患者一行，进度条（PLANNING→APPROVED→IN_PROGRESS→COMPLETED），逾期（计划完成日>7天未完成）标红。
- **FR-4.2 客户满意度评价/NPS**：Visit 完成后可录入口碑评价 5 星 + 文字 + 3 项子维度（技术/服务/环境），统计页显示平均分、差评列表、医生维度排行。NPS 0-10 分净推荐值计算。
- **FR-4.3 排班/考勤/请假**：StaffSchedule 表（日期+员工+班次+工位），排班日历视图，班次冲突（同一员工同时两班）自动拦截。请假审批走现有 RecordModifyRequest 通用审批模式。考勤可与预约联动。

### 五、数据与外设友好
- **FR-5.1 数据导入工具**：Patients/DrugCatalog/Inventory 三个核心对象支持 Excel(.xlsx)/CSV 批量导入。流程：选择模板下载→填写→上传→逐行校验→错误行标红导出原因→确认导入。库用现有 package.json 中的 xlsx。
- **FR-5.2 打印模板引擎**：提供 4 套标准模板（A5 病历首页 / 处方笺标准格式 / 80mm 热敏收费收据 / 患者标签条码）。实现：React + `@media print` CSS + 浏览器 `window.print()`。不做可视化拖拽编辑器。

### 六、桌面端与安全
- **FR-6.1 离线数据加密存储**：SQLite 数据库文件透明加密层（采用 SQLCipher 或 SEE 兼容方案），密钥从 secrets.json 的 JWT_SECRET 派生。启动阶段解密挂载；备份文件同步加密。
- **FR-6.2 Electron 系统托盘/最小化后台**：关闭主窗口不退出，隐藏到系统托盘；托盘菜单「打开主窗口/退出应用」；设置项可选「关闭即托盘/关闭即退出」。

## Non-Functional Requirements
- **NFR-1 单人可维护性**: 任一子功能年维护时间 < 2 小时；算法代码必须 100% 可解释（禁止黑箱）。
- **NFR-2 零外部依赖**: 除 xlsx/diff-match-patch 等成熟纯 JS 库外，不引入需要 SLA 的第三方 API 服务。
- **NFR-3 性能**: 规则引擎类（FR-3.x）单次执行 < 2 秒；头影测量计算 < 200ms；导入工具 1000 行 < 10 秒。
- **NFR-4 安全**: 所有新表必须带 clinicId + deletedAt + 审计日志；加密密钥不能 hardcode。
- **NFR-5 测试覆盖**: 每个功能模块新增单元测试，算法类（评分/公式/关联规则）必须覆盖边界值和正常值；总体测试数不下降。
- **NFR-6 降级可开关**: 每项「智能辅助」功能在 Settings 中提供单独 enable 开关，诊所觉得不实用可关。

## Constraints
- **Technical**:
  - 数据库：SQLite（不能换PostgreSQL/MySQL）
  - 后端：NestJS + better-sqlite3 原生 SQL（禁用 ORM，遵循 `.qoder/rules/no-orm-usage.md`）
  - 前端：React + Vite + Tailwind + Electron
  - 迁移：必须通过 `migrations.ts` 新增 v 版本，禁止手动改表
  - 遵循 `AGENTS.md` 所有约束（SQL 参数化、软删除、RolesGuard 等）
- **Business**:
  - 单人维护者时间有限：每个子功能必须可单独发布，不能一次全量上。
  - 功能以「诊所本地可用」为目标，不做云端大模型对接。
- **Dependencies**:
  - 纯 npm 包依赖：`xlsx`（可能已有）、`diff-match-patch`（或类似）、`better-sqlite3-multiple-ciphers`（若走 SQLCipher，评估后决定）。

## Assumptions
- A1: 诊所医生/正畸科医生具备头影测量标志点识别能力，软件只算不标，不做AI自动标。
- A2: 处方禁忌库内置默认值，诊所可自行增删。
- A3: 关联规则算法使用最简单的 SQL 计数版，性能不够时后续再切 Apriori，但默认数据量（10万条收费）SQL 足够。
- A4: SQLite 加密选社区免费方案，不采购商业 SEE 授权。

## Acceptance Criteria

### AC-1: 正畸头影测量可保存并复算
- **Given**: 一张已上传的头颅侧位片，医生完成 30 个关键点标注
- **When**: 点击「保存并分析」
- **Then**: 后端按 Tweed 等 4 种方法计算出全部 50+ 项指标、每项有值+单位+与正常值对比的颜色标签、记录持久化到 CephalometricRecord；再次打开时标注点和计算结果准确还原
- **Verification**: `programmatic`

### AC-2: 病历保存自动生成摘要
- **Given**: 患者一次 Visit 含诊断「26 慢性根尖周炎」+ Treatment「根管治疗」+ 主诉「牙痛 3 天」
- **When**: 医生保存病历
- **Then**: nextReminder 自动生成或可手动改写；summary 字段有一句话摘要如「26 根管治疗，充填完成，建议 2 周后冠修复」
- **Verification**: `programmatic`

### AC-3: 处方配伍禁忌命中警告
- **Given**: 处方中同时包含甲硝唑和酒精类酊剂（或双氯芬酸+华法林两种冲突药）
- **When**: 点击保存
- **Then**: 弹确认框「存在配伍禁忌：甲硝唑与酒精冲突（双硫仑样反应），是否继续？」，取消不保存，确认允许保存但写入审计日志
- **Verification**: `programmatic`

### AC-4: 患者风险评分输出等级
- **Given**: 患者 65 岁 + 糖尿病 + 缺失牙 10 颗 + 12 个月未就诊
- **When**: 点击「计算风险」
- **Then**: 龋风险/牙周风险/种植风险 3 项评分在合理范围（0-100），等级为「高/极高」，算法可通过单测逐项验证加减分逻辑
- **Verification**: `programmatic`

### AC-5: 收费智能补全推荐
- **Given**: 诊所历史有 50+ 条「根管治疗 + 纤维桩 + 钴铬冠」共现收费记录
- **When**: 收费页选择了「根管治疗」和「纤维桩」
- **Then**: 推荐区出现「钴铬冠」作为 Top 推荐，点击可一键加入
- **Verification**: `programmatic`（造 100 条模拟收费数据跑推荐）

### AC-6: 经营同比异常识别
- **Given**: 本月营收比上月跌 35%（其他月份波动<10%）
- **When**: 凌晨 cron 跑完
- **Then**: 仪表盘顶部出现红色预警条「本月营收较上月 -35%，请关注」，进入经营预警日志可查
- **Verification**: `programmatic`（构造同比数据注入）

### AC-7: 库存补货建议量合理
- **Given**: 某树脂材料近 90 天消耗 30 支、采购周期 7 天、当前库存 2 支、安全库存系数 1.5
- **When**: 运行补货建议
- **Then**: 建议采购量 ≈ (90天消耗/90 * 采购周期 * 安全系数) - 当前库存，数字合理（如 2-5 支范围）
- **Verification**: `programmatic`

### AC-8: RFM 分层正确
- **Given**: 张三：1 天前消费、90 天 20 次、消费 5 万 / 李四：200 天前消费、90 天 0 次、消费 0
- **When**: 运行 RFM 批处理
- **Then**: 张三打「重要价值客户」标签，李四打「流失客户」标签
- **Verification**: `programmatic`

### AC-9: 治疗进度看板逾期标红
- **Given**: 治疗计划 COMPLETED_DATE=10 天前，状态仍为 IN_PROGRESS
- **When**: 打开疗程进度看板
- **Then**: 该卡片行标红，显示「逾期 10 天」
- **Verification**: `human-judgment` + `programmatic`（逾期断言）

### AC-10: 满意度 NPS 计算正确
- **Given**: 20 份评价：Promoter(9-10分)12 人，Passive(7-8)5 人，Detractor(0-6)3 人
- **When**: 查看统计页
- **Then**: NPS = 12/20 - 3/20 = 45%，准确显示
- **Verification**: `programmatic`

### AC-11: 排班冲突拦截
- **Given**: 医生王某某日 8-12 点已排早班
- **When**: 管理员尝试再加一个同时段班次
- **Then**: 保存返回错误「同一员工同时存在两个班次冲突」
- **Verification**: `programmatic`

### AC-12: 患者批量导入校验与成功
- **Given**: 一个 100 行患者 Excel，含 3 行必填缺失/手机号格式错误
- **When**: 上传→校验
- **Then**: 显示「97 行可导入/3 行错误」，可下载标红错误行；确认后 97 行成功插入 Patient 表，带 clinicId
- **Verification**: `programmatic`

### AC-13: 打印模板布局正常
- **Given**: 一条处方笺/收费单/病历首页数据
- **When**: 点击「打印预览」
- **Then**: A4 宽度内无错位，字段对齐，诊所 logo/标题/时间/签名位置符合医院常规格式
- **Verification**: `human-judgment`（视觉检查）

### AC-14: SQLite 加密后离线不可读
- **Given**: 启用加密后生成的数据库文件
- **When**: 用 sqlite3 CLI 直接打开
- **Then**: 显示「文件不是数据库」或需要 key，用正确 key 才能读写；备份文件同步加密
- **Verification**: `programmatic`（命令行验证）

### AC-15: 关闭窗口缩到托盘不退出
- **Given**: Electron 窗口打开中
- **When**: 点右上角 X
- **Then**: 进程不退出，任务栏系统托盘出现图标；托盘菜单「打开」能恢复窗口
- **Verification**: `human-judgment`（桌面操作）

## Open Questions
- [ ] 头影测量默认支持哪 4 种分析方法？Tweed/McNamara/Steiner/Downs 是否足够，还是要加 Wits/Bjork？
- [ ] SQLite 透明加密具体采用哪种方案：SQLCipher 编译 better-sqlite3-multiple-ciphers VS 逻辑层文件级加密加解密？评估编译难度后定。
- [ ] 处方配伍禁忌表默认 100 条是否够用，是否需要提供《国家基本药物处方集》自动导入脚本？
- [ ] 关联规则算法（FR-3.4）阈值默认 0.4 是否合理，允许诊所调？
- [ ] RFM 分值 1-5 分阈值是写死还是 Settings 可调？
