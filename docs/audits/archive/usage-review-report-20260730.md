# Qoder 会话使用效率报告

项目：rongyi
范围：workspace-only

## 结论

4 个已复核长会话（S1-S4）全部达成任务目标（fully-achieved），长时长源于大范围审计/修复任务本身，未发现效率、任务拆分或模型问题。唯一摩擦是 S3 的 git 协议持续失败，已通过 raw HTTPS 绕过并沉淀为可复用经验。精确 token/credits 不可用（effort-proxy 口径），不做成本结论。

## 覆盖与计费口径

分析会话：188/188
活跃长会话：14
仅墙钟长会话：0
语义复核长会话：4/14
计费口径：effort-proxy
模型响应：0
非零 usage：0/0
未复核长会话不推断任务族或结果

## 关键问题

### P1：git 协议到 GitHub 持续 Connection reset 造成安装类任务摩擦
范围：S3（setup-runtime 任务族，4 个已复核长会话中的 1 个）
置信度：High
证据：S3 会话中 git clone 反复失败，最终改用 raw.githubusercontent.com HTTPS 逐文件下载完成 35/35 文件
影响：安装/拉取类任务耗时增加，274 分钟活跃时长中含网络重试开销
行动：遇 git clone 或 npx skills add 失败时直接改用 raw HTTPS 逐文件下载路径（已记录为 tool_experience 记忆）
节省口径：精确 token/credits 不可用，不做定量节省声明

## 长会话

已复核 4 个：S1 全面深度审计约 626 分钟（8 项任务全部完成、门禁通过并提交）；S2 审计修复约 322 分钟（3 个 P0 + 2 个 P1 + 1 个 P2 安全缺陷全部修复验证）；S3 技能安装约 274 分钟（4/4 完成，含 git 协议摩擦）；S4 第二轮审计约 261 分钟（4 阶段 18 项任务、5 次提交、工作树干净）。全部 fully-achieved。其余 10 个未复核长会话不下结论（4/14 有界视图）。

## 模型与结果

无模型归因数据（modelAttributedResponseCount=0），不比较任何模型结果；如需比较需 controlled A/B。

## 证据边界

计费口径为 effort-proxy：精确 token/credits 不可用，本报告不含任何精确成本或节省声明。会话事件来自本地静态分析；未复核长会话不推断任务族或结果，复核仅覆盖展示的 4 个候选。
