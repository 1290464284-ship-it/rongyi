# API 契约：原子保存端点

本文档登记处方与治疗计划“主记录 + 明细一次事务保存”的专用端点。这两个端点取代前端
“先 PATCH 主表、再逐条同步明细”的多请求拼装，任何一步失败整体回滚。

## 鉴权与权限

- 复用既有 `/api/v2/prescriptions` 与 `/api/v2/treatment-plans` 前缀的 clinical 路由策略。
- 请求必须携带登录态（Authorization Bearer token）。

## PATCH /api/v2/treatment-plans/:id/save

请求体：

```json
{
  "patientId": "string",
  "doctorId": "string",
  "name": "string",
  "status": "PLANNED | APPROVED | IN_PROGRESS | COMPLETED | CANCELLED",
  "totalFee": 0,
  "remark": "string | undefined",
  "items": [
    {
      "id": "string | undefined",
      "code": "string",
      "name": "string",
      "category": "string",
      "price": 0,
      "quantity": 1,
      "teethNumbers": ["11"],
      "status": "string"
    }
  ]
}
```

响应：

```json
{ "success": true, "data": { "id": "plan-id", "status": "APPROVED", "items": 3 } }
```

规则：

- 主表更新与明细新增/修改/软删在同一事务内；`id` 存在则更新，`id` 缺失则新增。
- 新增明细优先使用客户端提供的 `id` 作为主键，断网重试可幂等。
- `billed = 1` 的已划价明细：仅当内容与现有行完全一致时保留；修改或删除返回 409 并回滚。
- `totalFee`、`price` 为分；`quantity`、`price` 有上界校验。

## PATCH /api/v2/prescriptions/:id/save

请求体：

```json
{
  "patientId": "string",
  "doctorId": "string",
  "remark": "string | undefined",
  "status": "DRAFT | SUBMITTED | APPROVED | PROCESSED | CANCELLED",
  "items": [
    {
      "id": "string | undefined",
      "name": "string",
      "specification": "string | undefined",
      "dosage": "string | undefined",
      "frequency": "string | undefined",
      "days": 1,
      "quantity": 1,
      "price": 0
    }
  ]
}
```

响应：

```json
{ "success": true, "data": { "id": "prescription-id", "status": "DRAFT", "items": 2 } }
```

规则：

- 主表更新与明细 reconcile 同一事务；`id` 存在则更新，`id` 缺失则新增（沿用客户端 id）。
- `days` / `quantity` 为正整数且不超过 100 万；`price` 为非负整数（分）且不超过 1 亿元。

## 错误

- 404：主记录或明细不存在。
- 409：已划价治疗计划明细被修改/删除；业务冲突。
- 400：字段缺失、枚举非法、金额/数量越界、患者或医生不存在或跨诊所。

## 相关实现

- 服务：`apps/v2/src/server/application/service-modules/edit-save.ts`
- 路由：`apps/v2/src/server/http/routes/edit-save-routes.ts`
