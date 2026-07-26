# 通知系统

## 1. 通知系统架构

通知系统为牙科诊所管理系统提供实时通知和消息推送能力，支持多租户数据隔离。

### 架构组成

```
┌─────────────────────────────────────────────────────────────┐
│                        通知系统                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐      ┌──────────────────────────┐    │
│  │  REST API 层     │      │   服务层                  │    │
│  │  (Controller)    │─────▶│   (NotificationsService) │    │
│  └──────────────────┘      └──────────────────────────┘    │
│                                     │                       │
│                                     ▼                       │
│                            ┌─────────────────┐              │
│                            │   数据库层       │              │
│                            │   (Notification)│              │
│                            └─────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心特性

- **多租户隔离**：基于 `clinicId` 实现诊所间数据完全隔离
- **通知类型多样**：支持系统通知、预约提醒、收费通知、库存预警等多种类型
- **优先级机制**：支持低、普通、高、紧急四级优先级
- **未读统计**：按类型、按优先级统计未读数量
- **软删除**：通知删除采用软删除机制，保留数据轨迹
- **JSON 扩展字段**：`data` 字段支持存储任意结构化数据

### 目录结构

```
src/modules/notifications/
├── types/
│   └── notification.types.ts    # 类型定义
├── dto/
│   └── notification.dto.ts      # DTO 定义
├── sql/
│   └── notifications-table.sql  # 数据库建表 SQL
├── notifications.service.ts     # 通知服务
├── notifications.controller.ts  # REST 控制器
├── notifications.module.ts      # 模块定义
├── notifications.service.spec.ts    # 服务单元测试
├── notifications.controller.spec.ts # 控制器单元测试
└── index.ts                     # 导出
```

---

## 2. 通知类型说明

### 通知类型（NotificationType）

| 类型 | 枚举值 | 说明 | 典型场景 |
|------|--------|------|----------|
| 系统通知 | `system` | 系统级别的公告和通知 | 系统维护、版本更新、功能上线 |
| 预约提醒 | `appointment` | 预约相关的提醒 | 新预约、预约变更、就诊提醒 |
| 收费通知 | `charge` | 收费相关的通知 | 新收费单、欠费提醒、退费通知 |
| 库存预警 | `inventory` | 库存相关的预警 | 库存不足、过期预警、采购到货 |
| 患者相关 | `patient` | 患者相关的通知 | 新患者登记、患者随访提醒 |
| 临床相关 | `clinical` | 临床业务相关 | 初诊待处理、治疗计划审批 |
| 财务相关 | `financial` | 财务相关的通知 | 日结提醒、对账异常、会员卡充值 |
| 设备相关 | `equipment` | 设备相关的通知 | 设备维护提醒、故障报警 |

### 通知优先级（NotificationPriority）

| 优先级 | 枚举值 | 说明 | 处理时效 |
|--------|--------|------|----------|
| 低 | `low` | 一般信息，可延后处理 | 3 天内 |
| 普通 | `normal` | 常规通知，正常处理 | 当天内 |
| 高 | `high` | 重要通知，需尽快处理 | 2 小时内 |
| 紧急 | `urgent` | 紧急事项，需立即处理 | 立即 |

### 通知数据结构

```typescript
interface Notification {
  id: string;                    // 主键 UUID
  clinicId: string;              // 诊所 ID（多租户）
  userId: string | null;         // 接收用户 ID（null 表示广播）
  type: NotificationType;        // 通知类型
  title: string;                 // 标题
  content: string;               // 内容
  priority: NotificationPriority;// 优先级
  readAt: string | null;         // 已读时间
  data: Record<string, unknown> | null; // 扩展数据（JSON）
  createdAt: string;             // 创建时间
  updatedAt: string;             // 更新时间
  deletedAt: string | null;      // 删除时间（软删除）
}
```

---

## 3. WebSocket 连接方式

> **注意**：当前版本仅实现了 REST API 接口。WebSocket 实时推送功能作为可选增强，需要在安装 `@nestjs/websockets` 和 `@nestjs/platform-socket.io` 依赖后启用。

### 未来 WebSocket 集成方案（可选增强）

当项目需要实时通知能力时，可按以下方案集成：

#### 3.1 安装依赖

```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
```

#### 3.2 连接方式

```javascript
// 前端连接示例
import { io } from 'socket.io-client';

const socket = io('wss://your-api-domain.com/notifications', {
  query: {
    token: 'your-jwt-token',
  },
  transports: ['websocket'],
});
```

#### 3.3 认证机制

- 连接时通过 handshake.query.token 传递 JWT
- 服务端验证 token 有效性并提取 clinicId、userId
- 验证失败则拒绝连接

#### 3.4 房间机制

- 每个用户加入个人房间：`user:{userId}`
- 每个诊所加入诊所房间：`clinic:{clinicId}`
- 广播通知发送到诊所房间
- 个人通知发送到用户房间

#### 3.5 事件列表

| 事件名 | 方向 | 说明 |
|--------|------|------|
| `notification` | 服务端 → 客户端 | 推送新通知 |
| `unread-count` | 服务端 → 客户端 | 推送未读数量更新 |
| `mark-read` | 客户端 → 服务端 | 标记通知已读 |
| `mark-all-read` | 客户端 → 服务端 | 全部标记已读 |

---

## 4. REST API 说明

### 基础路径

```
/api/v1/notifications
```

### 4.1 分页获取通知列表

**GET** `/notifications`

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 20，最大 100 |
| type | string | 否 | 通知类型过滤 |
| priority | string | 否 | 优先级过滤 |
| isRead | boolean | 否 | 是否已读过滤 |
| keyword | string | 否 | 关键词搜索（标题、内容） |

**响应示例：**

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "system",
      "title": "系统维护通知",
      "content": "系统将于今晚 22:00-23:00 进行维护",
      "priority": "high",
      "readAt": null,
      "data": null,
      "createdAt": "2026-01-01T10:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### 4.2 获取未读通知数量

**GET** `/notifications/unread-count`

**响应示例：**

```json
{
  "total": 5,
  "byType": {
    "system": 2,
    "appointment": 1,
    "charge": 1,
    "inventory": 1,
    "patient": 0,
    "clinical": 0,
    "financial": 0,
    "equipment": 0
  },
  "byPriority": {
    "low": 1,
    "normal": 2,
    "high": 1,
    "urgent": 1
  }
}
```

### 4.3 获取单条通知详情

**GET** `/notifications/:id`

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 通知 ID |

### 4.4 标记单条通知已读

**POST** `/notifications/:id/read`

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 通知 ID |

**响应：** 返回更新后的通知对象

### 4.5 标记所有通知已读

**POST** `/notifications/read-all`

**响应示例：**

```json
{
  "count": 5
}
```

### 4.6 删除通知

**DELETE** `/notifications/:id`

> 采用软删除机制，设置 `deletedAt` 字段

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 通知 ID |

---

## 5. 最佳实践

### 5.1 发送通知

#### 在其他服务中使用通知服务

```typescript
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, NotificationPriority } from '../notifications/types/notification.types';

@Injectable()
export class AppointmentsService {
  constructor(private notificationsService: NotificationsService) {}

  async createAppointment(dto: CreateAppointmentDto) {
    // ... 创建预约逻辑

    // 发送通知给医生
    await this.notificationsService.sendToUser(dto.doctorId, {
      type: NotificationType.APPOINTMENT,
      title: '新预约提醒',
      content: `您有一个新的预约：${dto.patientName}`,
      priority: NotificationPriority.NORMAL,
      data: {
        appointmentId: appointment.id,
        patientId: dto.patientId,
      },
    });

    return appointment;
  }
}
```

#### 广播通知给诊所所有用户

```typescript
await this.notificationsService.broadcastToClinic({
  type: NotificationType.SYSTEM,
  title: '系统公告',
  content: '系统将于今晚进行维护升级',
  priority: NotificationPriority.HIGH,
  data: {
    maintenanceStart: '2026-01-01T22:00:00Z',
    maintenanceEnd: '2026-01-01T23:00:00Z',
  },
});
```

### 5.2 通知设计规范

#### 标题规范

- 控制在 20-50 字以内
- 清晰表达通知核心内容
- 避免使用感叹号等情绪化符号
- 重要通知可在标题前缀标注「紧急」「重要」

#### 内容规范

- 正文控制在 200 字以内
- 结构化信息放入 `data` 字段
- 提供关键信息，避免冗余
- 如需操作引导，明确告知操作路径

#### 优先级使用规范

| 优先级 | 使用场景 | 示例 |
|--------|----------|------|
| 紧急 (urgent) | 需要立即处理的紧急事项 | 系统故障、数据异常、安全警报 |
| 高 (high) | 重要业务通知，需尽快处理 | 预约取消、欠费预警、库存紧急 |
| 普通 (normal) | 常规业务通知 | 新预约、新收费、患者登记 |
| 低 (low) | 一般信息类通知 | 系统公告、功能更新、统计报表 |

### 5.3 性能优化

#### 批量发送

```typescript
// 对于批量通知场景，建议使用事务批量插入
async sendToUsers(userIds: string[], payload: Omit<NotificationPayload, 'userId'>) {
  return this.dbService.transaction((db) => {
    const results = [];
    for (const userId of userIds) {
      const result = this.create({ ...payload, userId });
      results.push(result);
    }
    return results;
  });
}
```

#### 定期清理

建议定期清理已删除超过 90 天的通知数据：

```sql
DELETE FROM Notification WHERE deletedAt IS NOT NULL AND deletedAt < date('now', '-90 days');
```

### 5.4 安全注意事项

1. **多租户隔离**：所有查询必须携带 `clinicId` 过滤条件
2. **用户权限**：用户只能查看自己的通知和诊所广播通知
3. **输入验证**：通知标题和内容需进行 XSS 过滤
4. **敏感数据**：不要在通知中包含密码、身份证号等敏感信息
5. **频率控制**：避免短时间内发送大量通知造成打扰

### 5.5 扩展建议

1. **通知模板**：建立通知模板系统，支持变量替换
2. **通知渠道**：扩展支持短信、邮件、微信等多渠道推送
3. **通知设置**：允许用户自定义通知接收偏好
4. **定时通知**：支持预约提醒等定时发送场景
5. **已读回执**：跟踪通知的阅读状态和时间
