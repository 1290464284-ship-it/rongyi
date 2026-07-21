# Dental Clinic Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现挂号预约、就诊闭环、牙位图全局联动三大核心创新

**Architecture:** 后端扩展 4 个 NestJS 模块（appointments/visits/tooth-records/treatments），前端构建 SVG 牙位图组件作为患者详情页的全局过滤器，联动右侧就诊时间轴。

**Tech Stack:** NestJS + Prisma + PostgreSQL / React 18 + TypeScript + Vite + TailwindCSS + @tanstack/react-query + SVG

---

## Schema 设计说明（Phase 2 范围）

Phase 2 在 Phase 1 已有的 `User / Patient / Family / Gender / Role` 基础上新增 4 个核心 model：`Appointment / Visit / ToothRecord / Treatment`，以及 2 个辅助 model：`TreatmentCatalog`（治疗项目字典，供 seed 与前端选择）、`DoctorSchedule`（医生排班模板，供日历页参考）。

**对原 schema 的两处修正（原文件 `docs/superpowers/plans/2026-07-16-dental-clinic-mvp.md` 行 233-300）：**

1. `ToothRecord.treatments Treatment[]` 删除 — Treatment 通过 `teethNumbers Int[]` 松耦合多颗牙，无需双向关系（Prisma 要求关系两侧都有字段，原 schema 在 Treatment 上缺少 `toothRecordId`，无法编译）。选中牙位过滤治疗记录改用 `teethNumbers has N` 查询，天然支持一颗治疗跨多颗牙。
2. `User` 新增 `visits Visit[]` 反向关系 — 原 schema 的 `Visit.doctor` 关系在 User 侧缺失反向字段，Prisma 无法编译。这是必要补全。
3. `Visit` 暂不包含 `notes ClinicalNote[]` / `charges Charge[]`（Phase 3/4 模型尚未建表），仅保留 `treatments Treatment[]`。
4. `Patient` / `User` 仅添加 Phase 2 涉及的反向关系字段（appointments/teeth/treatments/visits/schedules），Phase 3/4 的 charges/notes/prescriptions/images 关系留到后续阶段加。

**字段名前后端一致性约定（所有 Task 共用）：**

| Model | 关键字段 |
|-------|---------|
| Appointment | `id, patientId, doctorId, startTime, endTime, status, type, remark, createdAt, updatedAt, visit` |
| Visit | `id, patientId, appointmentId, doctorId, chiefComplaint, diagnosis, treatmentPlan, startTime, endTime, status, treatments` |
| ToothRecord | `id, patientId, toothNumber, currentStatus, conditions, remark, createdAt, updatedAt` |
| Treatment | `id, patientId, visitId, doctorId, code, name, category, price, quantity, teethNumbers, status, plannedDate, completedDate, remark, createdAt, updatedAt` |
| TreatmentCatalog | `id, code, name, category, price, remark` |
| DoctorSchedule | `id, doctorId, weekday, startTime, endTime` |

**枚举值（前端 TS 常量须与后端 Prisma 枚举完全一致）：**

```
AppointmentStatus: BOOKED | ARRIVED | IN_CHAIR | COMPLETED | CANCELLED | NO_SHOW
AppointmentType:   FIRST_VISIT | RETURN | CONSULTATION | EMERGENCY | RECALL
VisitStatus:       IN_PROGRESS | COMPLETED
ToothStatus:       SOUND | FILLED | CROWNED | MISSING | IMPLANT | BRIDGE | ROOT_CANAL | EXTRACTED | DECAYED
ToothCondition:    DECAY | FILLING | CROWN | BRIDGE | IMPLANT | ROOT_CANAL | EXTRACTION | MOBILITY | CALCULUS | BLEEDING | FURCATION | OTHER
TreatmentStatus:   PLANNED | APPROVED | IN_PROGRESS | COMPLETED | CANCELLED
```

---

## Task 1: 数据库 schema 扩展 + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: 修改 schema.prisma — 给 User / Patient 加反向关系字段**

打开 `apps/api/prisma/schema.prisma`，将 `model User` 替换为（在末尾追加三个反向关系字段）：

```prisma
model User {
  id           String   @id @default(cuid())
  username     String   @unique
  passwordHash String
  name         String
  role         Role     @default(RECEPTIONIST)
  phone        String?
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  appointments Appointment[] @relation("DoctorAppts")
  treatments   Treatment[]
  visits       Visit[]
  schedules    DoctorSchedule[]
}
```

将 `model Patient` 替换为（在 `@@index([name])` 之前追加四个反向关系字段）：

```prisma
model Patient {
  id            String   @id @default(cuid())
  code          String   @unique
  name          String
  gender        Gender
  birthDate     DateTime?
  phone         String
  idCard        String?
  address       String?
  occupation    String?
  remark        String?
  allergies     String[]
  medicalHistory String[]
  familyId      String?
  family        Family?  @relation(fields: [familyId], references: [id])
  referrer      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  appointments Appointment[]
  teeth        ToothRecord[]
  treatments   Treatment[]
  visits       Visit[]

  @@index([phone])
  @@index([name])
}
```

- [ ] **Step 2: 在 schema.prisma 末尾追加 4 个核心 model + 2 个辅助 model + 所有枚举**

在 `model Family` 定义之后追加以下内容：

```prisma
// ============ 就诊闭环 ============
model Appointment {
  id          String            @id @default(cuid())
  patientId   String
  patient     Patient           @relation(fields: [patientId], references: [id])
  doctorId    String
  doctor      User              @relation("DoctorAppts", fields: [doctorId], references: [id])
  startTime   DateTime
  endTime     DateTime
  status      AppointmentStatus @default(BOOKED)
  type        AppointmentType
  remark      String?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  visit       Visit?

  @@index([doctorId, startTime])
  @@index([patientId])
}

enum AppointmentStatus {
  BOOKED
  ARRIVED
  IN_CHAIR
  COMPLETED
  CANCELLED
  NO_SHOW
}

enum AppointmentType {
  FIRST_VISIT
  RETURN
  CONSULTATION
  EMERGENCY
  RECALL
}

model Visit {
  id             String      @id @default(cuid())
  patientId      String
  patient        Patient     @relation(fields: [patientId], references: [id])
  appointmentId  String?     @unique
  appointment    Appointment? @relation(fields: [appointmentId], references: [id])
  doctorId       String
  doctor         User        @relation(fields: [doctorId], references: [id])
  chiefComplaint String?
  diagnosis      String?
  treatmentPlan  String?
  startTime      DateTime    @default(now())
  endTime        DateTime?
  status         VisitStatus @default(IN_PROGRESS)

  treatments     Treatment[]

  @@index([patientId, startTime])
}

enum VisitStatus {
  IN_PROGRESS
  COMPLETED
}

// ============ 牙位与治疗 ============
model ToothRecord {
  id            String         @id @default(cuid())
  patientId     String
  patient       Patient        @relation(fields: [patientId], references: [id])
  toothNumber   Int
  currentStatus ToothStatus    @default(SOUND)
  conditions    ToothCondition[]
  remark        String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@unique([patientId, toothNumber])
  @@index([patientId])
}

enum ToothStatus {
  SOUND
  FILLED
  CROWNED
  MISSING
  IMPLANT
  BRIDGE
  ROOT_CANAL
  EXTRACTED
  DECAYED
}

enum ToothCondition {
  DECAY
  FILLING
  CROWN
  BRIDGE
  IMPLANT
  ROOT_CANAL
  EXTRACTION
  MOBILITY
  CALCULUS
  BLEEDING
  FURCATION
  OTHER
}

model Treatment {
  id            String           @id @default(cuid())
  patientId     String
  patient       Patient          @relation(fields: [patientId], references: [id])
  visitId       String?
  visit         Visit?           @relation(fields: [visitId], references: [id])
  doctorId      String
  doctor        User             @relation(fields: [doctorId], references: [id])
  code          String
  name          String
  category      String
  price         Decimal          @db.Decimal(10, 2)
  quantity      Int              @default(1)
  teethNumbers  Int[]
  status        TreatmentStatus  @default(PLANNED)
  plannedDate   DateTime?
  completedDate DateTime?
  remark        String?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt

  @@index([patientId, status])
  @@index([visitId])
}

enum TreatmentStatus {
  PLANNED
  APPROVED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

// ============ 辅助：治疗项目字典 + 医生排班 ============
model TreatmentCatalog {
  id        String   @id @default(cuid())
  code      String   @unique
  name      String
  category  String
  price     Decimal  @db.Decimal(10, 2)
  remark    String?
  createdAt DateTime @default(now())
}

model DoctorSchedule {
  id        String   @id @default(cuid())
  doctorId  String
  doctor    User     @relation(fields: [doctorId], references: [id])
  weekday   Int
  startTime String
  endTime   String
  createdAt DateTime @default(now())

  @@unique([doctorId, weekday])
}
```

- [ ] **Step 3: 运行迁移生成 Prisma Client**

```bash
cd apps/api; pnpm prisma migrate dev --name phase2
```

预期输出：`Applied migration` + `Generated Prisma Client`。如果报错 `relation field missing`，检查 Step 1 的反向关系字段是否都已添加。

- [ ] **Step 4: 验证 Prisma Client 生成成功**

```bash
cd apps/api; pnpm prisma generate
```

预期：`Generated Prisma Client to .\node_modules\@prisma\client`。

- [ ] **Step 5: 扩展 seed.ts — 治疗项目字典 + 医生排班**

将 `apps/api/prisma/seed.ts` 完整替换为：

```typescript
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('REDACTED', 10);

  // ---- 用户 ----
  const boss = await prisma.user.upsert({
    where: { username: 'boss' },
    update: {},
    create: { username: 'boss', passwordHash: hash, name: '老板', role: Role.BOSS },
  });
  const doctor = await prisma.user.upsert({
    where: { username: 'doctor' },
    update: {},
    create: { username: 'doctor', passwordHash: hash, name: '张医生', role: Role.DOCTOR },
  });
  const doctor2 = await prisma.user.upsert({
    where: { username: 'doctor2' },
    update: {},
    create: { username: 'doctor2', passwordHash: hash, name: '李医生', role: Role.DOCTOR },
  });
  await prisma.user.upsert({
    where: { username: 'front' },
    update: {},
    create: { username: 'front', passwordHash: hash, name: '前台', role: Role.RECEPTIONIST },
  });

  // ---- 治疗项目字典 ----
  const catalog: Array<{ code: string; name: string; category: string; price: number; remark?: string }> = [
    { code: 'D1110', name: '树脂补牙', category: '修复', price: 300, remark: '单面洞' },
    { code: 'D1120', name: '树脂补牙(双面)', category: '修复', price: 450 },
    { code: 'D2391', name: '光固化树脂充填', category: '修复', price: 500 },
    { code: 'D3330', name: '根管治疗(前牙)', category: '牙髓', price: 800 },
    { code: 'D3340', name: '根管治疗(后牙)', category: '牙髓', price: 1500 },
    { code: 'D6010', name: '拔牙(普通)', category: '外科', price: 200 },
    { code: 'D6011', name: '拔牙(阻生智齿)', category: '外科', price: 800 },
    { code: 'D1120P', name: '超声波洁牙', category: '预防', price: 150 },
    { code: 'D4341', name: '牙周刮治', category: '牙周', price: 600 },
    { code: 'D6010I', name: '种植牙', category: '种植', price: 8000, remark: '含基台冠' },
    { code: 'D2740', name: '烤瓷冠', category: '修复', price: 1200 },
    { code: 'D2750', name: '全瓷冠', category: '修复', price: 2500 },
    { code: 'D5211', name: '活动义齿', category: '修复', price: 1000 },
    { code: 'D1351', name: '窝沟封闭', category: '预防', price: 80 },
    { code: 'D1203', name: '儿童涂氟', category: '预防', price: 60 },
  ];
  for (const item of catalog) {
    await prisma.treatmentCatalog.upsert({
      where: { code: item.code },
      update: {},
      create: {
        code: item.code,
        name: item.name,
        category: item.category,
        price: item.price,
        remark: item.remark,
      },
    });
  }

  // ---- 医生排班（周一至周六 09:00-17:00）----
  const doctors = [doctor, doctor2];
  for (const d of doctors) {
    for (const weekday of [1, 2, 3, 4, 5, 6]) {
      await prisma.doctorSchedule.upsert({
        where: { doctorId_weekday: { doctorId: d.id, weekday } },
        update: {},
        create: { doctorId: d.id, weekday, startTime: '09:00', endTime: '17:00' },
      });
    }
  }

  console.log('Seed 完成，默认密码均为 123456');
  console.log(`治疗项目字典: ${catalog.length} 项`);
  console.log(`医生排班: ${doctors.length} 位医生 × 6 天`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

- [ ] **Step 6: 运行 seed 验证**

```bash
cd apps/api; pnpm prisma:seed
```

预期输出包含 `Seed 完成` 和项目数量。

- [ ] **Step 7: 提交**

```bash
cd apps/api; git add prisma/schema.prisma prisma/seed.ts prisma/migrations; git commit -m "feat(api): add Appointment/Visit/ToothRecord/Treatment schema + seed catalog and schedule"
```

---

## Task 2: 后端 appointments 模块（含到诊状态机）

**Files:**
- Create: `apps/api/src/modules/appointments/appointments.module.ts`
- Create: `apps/api/src/modules/appointments/appointments.controller.ts`
- Create: `apps/api/src/modules/appointments/appointments.service.ts`
- Create: `apps/api/src/modules/appointments/dto/create-appointment.dto.ts`
- Create: `apps/api/src/modules/appointments/dto/update-appointment.dto.ts`
- Create: `apps/api/src/modules/appointments/dto/query-appointment.dto.ts`
- Create: `apps/api/test/appointments.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 CreateAppointmentDto**

创建 `apps/api/src/modules/appointments/dto/create-appointment.dto.ts`：

```typescript
import { IsString, IsEnum, IsOptional, IsDateString } from 'class-validator';
import { AppointmentType } from '@prisma/client';

export class CreateAppointmentDto {
  @IsString()
  patientId!: string;

  @IsString()
  doctorId!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @IsOptional()
  @IsString()
  remark?: string;
}
```

- [ ] **Step 2: 创建 UpdateAppointmentDto**

创建 `apps/api/src/modules/appointments/dto/update-appointment.dto.ts`：

```typescript
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { CreateAppointmentDto } from './create-appointment.dto';

export class UpdateAppointmentDto extends OmitType(PartialType(CreateAppointmentDto), [
  'patientId',
  'doctorId',
] as const) {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;
}
```

- [ ] **Step 3: 创建 QueryAppointmentDto**

创建 `apps/api/src/modules/appointments/dto/query-appointment.dto.ts`：

```typescript
import { IsOptional, IsString, IsEnum, IsDateString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AppointmentStatus } from '@prisma/client';

export class QueryAppointmentDto {
  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 50;
}
```

- [ ] **Step 4: 创建 appointments.service.ts（含状态机 + 冲突检测）**

创建 `apps/api/src/modules/appointments/appointments.service.ts`：

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';

// 合法的状态流转：from -> [允许的 to]
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: ['ARRIVED', 'CANCELLED', 'NO_SHOW', 'IN_CHAIR'],
  ARRIVED: ['IN_CHAIR', 'CANCELLED', 'NO_SHOW'],
  IN_CHAIR: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAppointmentDto) {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (endTime <= startTime) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    // 冲突检测：同医生同时间段已有有效预约
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        doctorId: dto.doctorId,
        status: { in: ['BOOKED', 'ARRIVED', 'IN_CHAIR'] },
        AND: [
          { startTime: { lt: endTime } },
          { endTime: { gt: startTime } },
        ],
      },
    });
    if (conflict) {
      throw new BadRequestException('该时间段医生已有预约');
    }

    return this.prisma.appointment.create({
      data: {
        patientId: dto.patientId,
        doctorId: dto.doctorId,
        startTime,
        endTime,
        type: dto.type,
        remark: dto.remark,
      },
      include: { patient: true, doctor: true },
    });
  }

  async findMany(q: QueryAppointmentDto) {
    const { doctorId, patientId, status, startDate, endDate, page = 1, pageSize = 50 } = q;
    const where: Prisma.AppointmentWhereInput = {};
    if (doctorId) where.doctorId = doctorId;
    if (patientId) where.patientId = patientId;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime.gte = new Date(startDate);
      if (endDate) where.startTime.lte = new Date(endDate);
    }
    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        orderBy: { startTime: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { patient: true, doctor: true },
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const a = await this.prisma.appointment.findUnique({
      where: { id },
      include: { patient: true, doctor: true, visit: true },
    });
    if (!a) throw new NotFoundException('预约不存在');
    return a;
  }

  async update(id: string, dto: UpdateAppointmentDto) {
    const existing = await this.findOne(id);

    // 状态流转校验
    if (dto.status && dto.status !== existing.status) {
      const allowed = TRANSITIONS[existing.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `非法状态流转: ${existing.status} -> ${dto.status}`,
        );
      }
    }

    // 改时间时重新做冲突检测（排除自身）
    if (dto.startTime || dto.endTime) {
      const startTime = new Date(dto.startTime ?? existing.startTime);
      const endTime = new Date(dto.endTime ?? existing.endTime);
      if (endTime <= startTime) {
        throw new BadRequestException('结束时间必须晚于开始时间');
      }
      const conflict = await this.prisma.appointment.findFirst({
        where: {
          id: { not: id },
          doctorId: existing.doctorId,
          status: { in: ['BOOKED', 'ARRIVED', 'IN_CHAIR'] },
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } },
          ],
        },
      });
      if (conflict) {
        throw new BadRequestException('该时间段医生已有预约');
      }
    }

    return this.prisma.appointment.update({
      where: { id },
      data: {
        status: dto.status,
        type: dto.type,
        remark: dto.remark,
        startTime: dto.startTime ? new Date(dto.startTime) : undefined,
        endTime: dto.endTime ? new Date(dto.endTime) : undefined,
      },
      include: { patient: true, doctor: true, visit: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.appointment.delete({ where: { id } });
  }
}
```

- [ ] **Step 5: 创建 appointments.controller.ts**

创建 `apps/api/src/modules/appointments/appointments.controller.ts`：

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';

@UseGuards(JwtAuthGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private appointments: AppointmentsService) {}

  @Post()
  create(@Body() dto: CreateAppointmentDto) {
    return this.appointments.create(dto);
  }

  @Get()
  findMany(@Query() q: QueryAppointmentDto) {
    return this.appointments.findMany(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.appointments.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return this.appointments.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.appointments.remove(id);
  }
}
```

- [ ] **Step 6: 创建 appointments.module.ts**

创建 `apps/api/src/modules/appointments/appointments.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
```

- [ ] **Step 7: 注册到 app.module.ts**

修改 `apps/api/src/app.module.ts`，在 imports 数组中加入 `AppointmentsModule`：

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    AppointmentsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 8: 创建 e2e 测试**

创建 `apps/api/test/appointments.e2e-spec.ts`：

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Appointments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;

  const baseTime = '2026-08-01T09:00:00.000Z';
  const baseEnd = '2026-08-01T09:30:00.000Z';

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'REDACTED' });
    return res.body.access_token as string;
  }

  async function createPatient(name: string, phone: string) {
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, gender: 'MALE', phone });
    return res.body.id as string;
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.user.deleteMany({});
    const hash = await bcrypt.hash('REDACTED', 10);
    const doc = await prisma.user.create({
      data: { username: 'doc1', passwordHash: hash, name: '王医生', role: 'DOCTOR' },
    });
    doctorId = doc.id;
    await prisma.user.create({
      data: { username: 'boss', passwordHash: hash, name: '老板', role: 'BOSS' },
    });
    token = await login();
    patientId = await createPatient('赵六', '13700137000');
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/appointments 创建预约', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId,
        startTime: baseTime,
        endTime: baseEnd,
        type: 'FIRST_VISIT',
      });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('BOOKED');
    expect(res.body.type).toBe('FIRST_VISIT');
    appointmentId = res.body.id;
  });

  it('POST 同医生同时段冲突检测返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId,
        startTime: '2026-08-01T09:15:00.000Z',
        endTime: '2026-08-01T09:45:00.000Z',
        type: 'RETURN',
      });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('GET /api/appointments 查询列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/appointments')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].patient.name).toBe('赵六');
  });

  it('GET /api/appointments 按医生筛选', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/appointments?doctorId=${doctorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/appointments/:id 详情', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(appointmentId);
  });

  it('PATCH 状态流转 BOOKED -> ARRIVED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARRIVED' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.status).toBe('ARRIVED');
  });

  it('PATCH 状态流转 ARRIVED -> IN_CHAIR', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_CHAIR' });
    expect(res.body.status).toBe('IN_CHAIR');
  });

  it('PATCH 非法状态流转 IN_CHAIR -> ARRIVED 返回 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARRIVED' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('PATCH 状态流转 IN_CHAIR -> COMPLETED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' });
    expect(res.body.status).toBe('COMPLETED');
  });

  it('未带 token 返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/appointments');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
```

- [ ] **Step 9: 运行 e2e 测试**

```bash
cd apps/api; pnpm test:e2e -- appointments.e2e-spec.ts
```

预期：所有测试通过（9 passed）。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/appointments apps/api/src/app.module.ts apps/api/test/appointments.e2e-spec.ts; git commit -m "feat(api): add appointments module with state machine and conflict detection"
```

---

## Task 3: 后端 visits 模块

**Files:**
- Create: `apps/api/src/modules/visits/visits.module.ts`
- Create: `apps/api/src/modules/visits/visits.controller.ts`
- Create: `apps/api/src/modules/visits/visits.service.ts`
- Create: `apps/api/src/modules/visits/dto/create-visit.dto.ts`
- Create: `apps/api/src/modules/visits/dto/complete-visit.dto.ts`
- Create: `apps/api/src/modules/visits/dto/query-visit.dto.ts`
- Create: `apps/api/test/visits.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 CreateVisitDto**

创建 `apps/api/src/modules/visits/dto/create-visit.dto.ts`：

```typescript
import { IsString, IsOptional } from 'class-validator';

export class CreateVisitDto {
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsString()
  patientId!: string;

  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  treatmentPlan?: string;
}
```

- [ ] **Step 2: 创建 CompleteVisitDto**

创建 `apps/api/src/modules/visits/dto/complete-visit.dto.ts`：

```typescript
import { IsOptional, IsString } from 'class-validator';

export class CompleteVisitDto {
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  treatmentPlan?: string;
}
```

- [ ] **Step 3: 创建 QueryVisitDto**

创建 `apps/api/src/modules/visits/dto/query-visit.dto.ts`：

```typescript
import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { VisitStatus } from '@prisma/client';

export class QueryVisitDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 50;
}
```

- [ ] **Step 4: 创建 visits.service.ts**

创建 `apps/api/src/modules/visits/visits.service.ts`：

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { QueryVisitDto } from './dto/query-visit.dto';

@Injectable()
export class VisitsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateVisitDto) {
    // 如果从预约创建，校验预约状态并联动
    let appointment: { id: string; status: string; doctorId: string; patientId: string } | null = null;
    if (dto.appointmentId) {
      appointment = await this.prisma.appointment.findUnique({
        where: { id: dto.appointmentId },
      });
      if (!appointment) throw new NotFoundException('预约不存在');
      if (appointment.status !== 'BOOKED' && appointment.status !== 'ARRIVED') {
        throw new BadRequestException('预约状态不允许开始就诊');
      }
    }

    // 事务：创建 visit + 更新 appointment 状态
    const visit = await this.prisma.$transaction(async (tx) => {
      const v = await tx.visit.create({
        data: {
          patientId: dto.patientId,
          appointmentId: dto.appointmentId,
          doctorId: dto.doctorId,
          chiefComplaint: dto.chiefComplaint,
          diagnosis: dto.diagnosis,
          treatmentPlan: dto.treatmentPlan,
          status: 'IN_PROGRESS',
        },
        include: { patient: true, doctor: true, appointment: true },
      });
      if (appointment) {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: 'IN_CHAIR' },
        });
      }
      return v;
    });
    return visit;
  }

  async findMany(q: QueryVisitDto) {
    const { patientId, doctorId, status, page = 1, pageSize = 50 } = q;
    const where: Prisma.VisitWhereInput = {};
    if (patientId) where.patientId = patientId;
    if (doctorId) where.doctorId = doctorId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { patient: true, doctor: true, appointment: true, treatments: true },
      }),
      this.prisma.visit.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const v = await this.prisma.visit.findUnique({
      where: { id },
      include: { patient: true, doctor: true, appointment: true, treatments: true },
    });
    if (!v) throw new NotFoundException('就诊记录不存在');
    return v;
  }

  async complete(id: string, dto: CompleteVisitDto) {
    const existing = await this.findOne(id);
    if (existing.status === 'COMPLETED') {
      throw new BadRequestException('该就诊已完成');
    }
    // 事务：完成 visit + 完成关联预约
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.visit.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          endTime: new Date(),
          diagnosis: dto.diagnosis,
          treatmentPlan: dto.treatmentPlan,
        },
        include: { patient: true, doctor: true, appointment: true, treatments: true },
      });
      if (existing.appointmentId) {
        await tx.appointment.update({
          where: { id: existing.appointmentId },
          data: { status: 'COMPLETED' },
        });
      }
      return v;
    });
  }
}
```

- [ ] **Step 5: 创建 visits.controller.ts**

创建 `apps/api/src/modules/visits/visits.controller.ts`：

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { QueryVisitDto } from './dto/query-visit.dto';

@UseGuards(JwtAuthGuard)
@Controller('visits')
export class VisitsController {
  constructor(private visits: VisitsService) {}

  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto);
  }

  @Get()
  findMany(@Query() q: QueryVisitDto) {
    return this.visits.findMany(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findOne(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteVisitDto) {
    return this.visits.complete(id, dto);
  }
}
```

- [ ] **Step 6: 创建 visits.module.ts**

创建 `apps/api/src/modules/visits/visits.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
```

- [ ] **Step 7: 注册到 app.module.ts**

修改 `apps/api/src/app.module.ts`，加入 `VisitsModule`：

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { VisitsModule } from './modules/visits/visits.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    AppointmentsModule,
    VisitsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 8: 创建 e2e 测试**

创建 `apps/api/test/visits.e2e-spec.ts`：

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Visits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;
  let visitId: string;

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'REDACTED' });
    return res.body.access_token as string;
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.visit.deleteMany({});
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.user.deleteMany({});
    const hash = await bcrypt.hash('REDACTED', 10);
    const doc = await prisma.user.create({
      data: { username: 'docv', passwordHash: hash, name: '陈医生', role: 'DOCTOR' },
    });
    doctorId = doc.id;
    await prisma.user.create({
      data: { username: 'boss', passwordHash: hash, name: '老板', role: 'BOSS' },
    });
    token = await login();
    const p = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '孙七', gender: 'FEMALE', phone: '13800138888' });
    patientId = p.body.id;
    const a = await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId,
        startTime: '2026-08-02T10:00:00.000Z',
        endTime: '2026-08-02T10:30:00.000Z',
        type: 'FIRST_VISIT',
      });
    appointmentId = a.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/visits 从预约创建就诊', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/visits')
      .set('Authorization', `Bearer ${token}`)
      .send({
        appointmentId,
        patientId,
        doctorId,
        chiefComplaint: '牙痛',
      });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.appointmentId).toBe(appointmentId);
    visitId = res.body.id;
  });

  it('从预约创建就诊后，预约状态变为 IN_CHAIR', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.status).toBe('IN_CHAIR');
  });

  it('GET /api/visits 查询列表', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/visits?patientId=${patientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/visits/:id 详情', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(visitId);
  });

  it('PATCH /api/visits/:id/complete 完成就诊', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ diagnosis: '急性牙髓炎', treatmentPlan: '根管治疗' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.endTime).toBeDefined();
    expect(res.body.diagnosis).toBe('急性牙髓炎');
  });

  it('完成就诊后，预约状态变为 COMPLETED', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('重复完成已完成的就诊返回 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('未带 token 返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/visits');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
```

- [ ] **Step 9: 运行 e2e 测试**

```bash
cd apps/api; pnpm test:e2e -- visits.e2e-spec.ts
```

预期：所有测试通过（8 passed）。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/visits apps/api/src/app.module.ts apps/api/test/visits.e2e-spec.ts; git commit -m "feat(api): add visits module with appointment status linkage"
```

---

## Task 4: 后端 tooth-records 模块

**Files:**
- Create: `apps/api/src/modules/tooth-records/tooth-records.module.ts`
- Create: `apps/api/src/modules/tooth-records/tooth-records.controller.ts`
- Create: `apps/api/src/modules/tooth-records/tooth-records.service.ts`
- Create: `apps/api/src/modules/tooth-records/dto/upsert-tooth.dto.ts`
- Create: `apps/api/src/modules/tooth-records/dto/query-tooth.dto.ts`
- Create: `apps/api/test/tooth-records.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 UpsertToothDto**

创建 `apps/api/src/modules/tooth-records/dto/upsert-tooth.dto.ts`：

```typescript
import {
  IsString,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ToothStatus, ToothCondition } from '@prisma/client';

export class UpsertToothDto {
  @IsString()
  patientId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(11)
  @Max(85)
  toothNumber!: number;

  @IsOptional()
  @IsEnum(ToothStatus)
  currentStatus?: ToothStatus;

  @IsOptional()
  @IsArray()
  @IsEnum(ToothCondition, { each: true })
  conditions?: ToothCondition[];

  @IsOptional()
  @IsString()
  remark?: string;
}
```

- [ ] **Step 2: 创建 QueryToothDto**

创建 `apps/api/src/modules/tooth-records/dto/query-tooth.dto.ts`：

```typescript
import { IsString } from 'class-validator';

export class QueryToothDto {
  @IsString()
  patientId!: string;
}
```

- [ ] **Step 3: 创建 tooth-records.service.ts**

创建 `apps/api/src/modules/tooth-records/tooth-records.service.ts`：

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertToothDto } from './dto/upsert-tooth.dto';
import { QueryToothDto } from './dto/query-tooth.dto';

@Injectable()
export class ToothRecordsService {
  constructor(private prisma: PrismaService) {}

  async findMany(q: QueryToothDto) {
    return this.prisma.toothRecord.findMany({
      where: { patientId: q.patientId },
      orderBy: { toothNumber: 'asc' },
    });
  }

  async findOne(patientId: string, toothNumber: number) {
    const t = await this.prisma.toothRecord.findUnique({
      where: { patientId_toothNumber: { patientId, toothNumber } },
    });
    if (!t) throw new NotFoundException('牙位记录不存在');
    return t;
  }

  async upsert(dto: UpsertToothDto) {
    return this.prisma.toothRecord.upsert({
      where: {
        patientId_toothNumber: {
          patientId: dto.patientId,
          toothNumber: dto.toothNumber,
        },
      },
      create: {
        patientId: dto.patientId,
        toothNumber: dto.toothNumber,
        currentStatus: dto.currentStatus ?? 'SOUND',
        conditions: dto.conditions ?? [],
        remark: dto.remark,
      },
      update: {
        currentStatus: dto.currentStatus,
        conditions: dto.conditions,
        remark: dto.remark,
      },
    });
  }

  async remove(patientId: string, toothNumber: number) {
    await this.findOne(patientId, toothNumber);
    return this.prisma.toothRecord.delete({
      where: { patientId_toothNumber: { patientId, toothNumber } },
    });
  }
}
```

- [ ] **Step 4: 创建 tooth-records.controller.ts**

创建 `apps/api/src/modules/tooth-records/tooth-records.controller.ts`：

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ToothRecordsService } from './tooth-records.service';
import { UpsertToothDto } from './dto/upsert-tooth.dto';
import { QueryToothDto } from './dto/query-tooth.dto';

@UseGuards(JwtAuthGuard)
@Controller('tooth-records')
export class ToothRecordsController {
  constructor(private teeth: ToothRecordsService) {}

  @Get()
  findMany(@Query() q: QueryToothDto) {
    return this.teeth.findMany(q);
  }

  @Get(':toothNumber')
  findOne(@Query('patientId') patientId: string, @Param('toothNumber') toothNumber: number) {
    return this.teeth.findOne(patientId, Number(toothNumber));
  }

  @Post()
  upsert(@Body() dto: UpsertToothDto) {
    return this.teeth.upsert(dto);
  }

  @Delete(':toothNumber')
  remove(@Query('patientId') patientId: string, @Param('toothNumber') toothNumber: number) {
    return this.teeth.remove(patientId, Number(toothNumber));
  }
}
```

- [ ] **Step 5: 创建 tooth-records.module.ts**

创建 `apps/api/src/modules/tooth-records/tooth-records.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { ToothRecordsController } from './tooth-records.controller';
import { ToothRecordsService } from './tooth-records.service';

@Module({
  controllers: [ToothRecordsController],
  providers: [ToothRecordsService],
  exports: [ToothRecordsService],
})
export class ToothRecordsModule {}
```

- [ ] **Step 6: 注册到 app.module.ts**

修改 `apps/api/src/app.module.ts`，加入 `ToothRecordsModule`：

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { VisitsModule } from './modules/visits/visits.module';
import { ToothRecordsModule } from './modules/tooth-records/tooth-records.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    AppointmentsModule,
    VisitsModule,
    ToothRecordsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: 创建 e2e 测试**

创建 `apps/api/test/tooth-records.e2e-spec.ts`：

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('ToothRecords (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let patientId: string;

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'REDACTED' });
    return res.body.access_token as string;
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.toothRecord.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.user.deleteMany({});
    const hash = await bcrypt.hash('REDACTED', 10);
    await prisma.user.create({
      data: { username: 'boss', passwordHash: hash, name: '老板', role: 'BOSS' },
    });
    token = await login();
    const p = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '周八', gender: 'MALE', phone: '13900139999' });
    patientId = p.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST upsert 创建牙位记录（16号牙龋齿）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tooth-records')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        toothNumber: 16,
        currentStatus: 'DECAYED',
        conditions: ['DECAY'],
        remark: '远中邻面龋',
      });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.toothNumber).toBe(16);
    expect(res.body.currentStatus).toBe('DECAYED');
    expect(res.body.conditions).toContain('DECAY');
  });

  it('POST upsert 同牙位再写入为更新', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tooth-records')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        toothNumber: 16,
        currentStatus: 'FILLED',
        conditions: ['FILLING'],
      });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.currentStatus).toBe('FILLED');
    expect(res.body.conditions).toContain('FILLING');
  });

  it('POST upsert 第二颗牙（11号牙健康）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tooth-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId, toothNumber: 11 });
    expect(res.body.currentStatus).toBe('SOUND');
  });

  it('GET 按患者查询所有牙位记录', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/tooth-records?patientId=${patientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].toothNumber).toBe(11);
    expect(res.body[1].toothNumber).toBe(16);
  });

  it('GET 单颗牙位详情', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/tooth-records/16?patientId=${patientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.toothNumber).toBe(16);
  });

  it('GET 不存在的牙位记录返回 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/tooth-records/48?patientId=${patientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('DELETE 删除牙位记录', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/tooth-records/11?patientId=${patientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    const list = await request(app.getHttpServer())
      .get(`/api/tooth-records?patientId=${patientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.body).toHaveLength(1);
  });

  it('未带 token 返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/tooth-records');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
```

- [ ] **Step 8: 运行 e2e 测试**

```bash
cd apps/api; pnpm test:e2e -- tooth-records.e2e-spec.ts
```

预期：所有测试通过（8 passed）。

- [ ] **Step 9: 提交**

```bash
git add apps/api/src/modules/tooth-records apps/api/src/app.module.ts apps/api/test/tooth-records.e2e-spec.ts; git commit -m "feat(api): add tooth-records module with upsert by patient+toothNumber"
```

---

## Task 5: 后端 treatments 模块

**Files:**
- Create: `apps/api/src/modules/treatments/treatments.module.ts`
- Create: `apps/api/src/modules/treatments/treatments.controller.ts`
- Create: `apps/api/src/modules/treatments/treatments.service.ts`
- Create: `apps/api/src/modules/treatments/dto/create-treatment.dto.ts`
- Create: `apps/api/src/modules/treatments/dto/update-treatment.dto.ts`
- Create: `apps/api/src/modules/treatments/dto/query-treatment.dto.ts`
- Create: `apps/api/test/treatments.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 CreateTreatmentDto**

创建 `apps/api/src/modules/treatments/dto/create-treatment.dto.ts`：

```typescript
import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsArray,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTreatmentDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsString()
  doctorId!: string;

  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  category!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number = 1;

  @IsOptional()
  @IsArray()
  teethNumbers?: number[];

  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
```

- [ ] **Step 2: 创建 UpdateTreatmentDto**

创建 `apps/api/src/modules/treatments/dto/update-treatment.dto.ts`：

```typescript
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { TreatmentStatus } from '@prisma/client';
import { CreateTreatmentDto } from './create-treatment.dto';

export class UpdateTreatmentDto extends OmitType(PartialType(CreateTreatmentDto), [
  'patientId',
  'doctorId',
] as const) {
  @IsOptional()
  @IsEnum(TreatmentStatus)
  status?: TreatmentStatus;

  @IsOptional()
  @IsDateString()
  completedDate?: string;
}
```

- [ ] **Step 3: 创建 QueryTreatmentDto**

创建 `apps/api/src/modules/treatments/dto/query-treatment.dto.ts`：

```typescript
import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TreatmentStatus } from '@prisma/client';

export class QueryTreatmentDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toothNumber?: number;

  @IsOptional()
  @IsEnum(TreatmentStatus)
  status?: TreatmentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 50;
}
```

- [ ] **Step 4: 创建 treatments.service.ts（含状态流转）**

创建 `apps/api/src/modules/treatments/treatments.service.ts`：

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, TreatmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTreatmentDto } from './dto/create-treatment.dto';
import { UpdateTreatmentDto } from './dto/update-treatment.dto';
import { QueryTreatmentDto } from './dto/query-treatment.dto';

const TRANSITIONS: Record<TreatmentStatus, TreatmentStatus[]> = {
  PLANNED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class TreatmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTreatmentDto) {
    return this.prisma.treatment.create({
      data: {
        patientId: dto.patientId,
        visitId: dto.visitId,
        doctorId: dto.doctorId,
        code: dto.code,
        name: dto.name,
        category: dto.category,
        price: new Prisma.Decimal(dto.price),
        quantity: dto.quantity,
        teethNumbers: dto.teethNumbers ?? [],
        plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : null,
        remark: dto.remark,
      },
      include: { patient: true, doctor: true, visit: true },
    });
  }

  async findMany(q: QueryTreatmentDto) {
    const { patientId, visitId, toothNumber, status, page = 1, pageSize = 50 } = q;
    const where: Prisma.TreatmentWhereInput = {};
    if (patientId) where.patientId = patientId;
    if (visitId) where.visitId = visitId;
    if (status) where.status = status;
    if (toothNumber) where.teethNumbers = { has: toothNumber };
    const [items, total] = await Promise.all([
      this.prisma.treatment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { patient: true, doctor: true, visit: true },
      }),
      this.prisma.treatment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const t = await this.prisma.treatment.findUnique({
      where: { id },
      include: { patient: true, doctor: true, visit: true },
    });
    if (!t) throw new NotFoundException('治疗记录不存在');
    return t;
  }

  async update(id: string, dto: UpdateTreatmentDto) {
    const existing = await this.findOne(id);

    if (dto.status && dto.status !== existing.status) {
      const allowed = TRANSITIONS[existing.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `非法状态流转: ${existing.status} -> ${dto.status}`,
        );
      }
    }

    // 标记完成时自动写 completedDate
    let completedDate = dto.completedDate
      ? new Date(dto.completedDate)
      : undefined;
    if (dto.status === 'COMPLETED' && !existing.completedDate) {
      completedDate = new Date();
    }

    return this.prisma.treatment.update({
      where: { id },
      data: {
        status: dto.status,
        code: dto.code,
        name: dto.name,
        category: dto.category,
        price: dto.price !== undefined ? new Prisma.Decimal(dto.price) : undefined,
        quantity: dto.quantity,
        teethNumbers: dto.teethNumbers,
        plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
        completedDate,
        remark: dto.remark,
      },
      include: { patient: true, doctor: true, visit: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.treatment.delete({ where: { id } });
  }
}
```

> 注意：`Prisma.Decimal` 用于将前端传入的 number 转换为 Prisma 的 Decimal 类型。返回给前端时 `price` 字段会序列化为字符串，前端用 `Number(price)` 转换。

- [ ] **Step 5: 创建 treatments.controller.ts**

创建 `apps/api/src/modules/treatments/treatments.controller.ts`：

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TreatmentsService } from './treatments.service';
import { CreateTreatmentDto } from './dto/create-treatment.dto';
import { UpdateTreatmentDto } from './dto/update-treatment.dto';
import { QueryTreatmentDto } from './dto/query-treatment.dto';

@UseGuards(JwtAuthGuard)
@Controller('treatments')
export class TreatmentsController {
  constructor(private treatments: TreatmentsService) {}

  @Post()
  create(@Body() dto: CreateTreatmentDto) {
    return this.treatments.create(dto);
  }

  @Get()
  findMany(@Query() q: QueryTreatmentDto) {
    return this.treatments.findMany(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.treatments.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTreatmentDto) {
    return this.treatments.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.treatments.remove(id);
  }
}
```

- [ ] **Step 6: 创建 treatments.module.ts**

创建 `apps/api/src/modules/treatments/treatments.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { TreatmentsController } from './treatments.controller';
import { TreatmentsService } from './treatments.service';

@Module({
  controllers: [TreatmentsController],
  providers: [TreatmentsService],
  exports: [TreatmentsService],
})
export class TreatmentsModule {}
```

- [ ] **Step 7: 注册到 app.module.ts**

修改 `apps/api/src/app.module.ts`，加入 `TreatmentsModule`：

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { VisitsModule } from './modules/visits/visits.module';
import { ToothRecordsModule } from './modules/tooth-records/tooth-records.module';
import { TreatmentsModule } from './modules/treatments/treatments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    AppointmentsModule,
    VisitsModule,
    ToothRecordsModule,
    TreatmentsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 8: 创建 e2e 测试**

创建 `apps/api/test/treatments.e2e-spec.ts`：

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Treatments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let doctorId: string;
  let patientId: string;
  let treatmentId: string;

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'REDACTED' });
    return res.body.access_token as string;
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.treatment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.user.deleteMany({});
    const hash = await bcrypt.hash('REDACTED', 10);
    const doc = await prisma.user.create({
      data: { username: 'doct', passwordHash: hash, name: '刘医生', role: 'DOCTOR' },
    });
    doctorId = doc.id;
    await prisma.user.create({
      data: { username: 'boss', passwordHash: hash, name: '老板', role: 'BOSS' },
    });
    token = await login();
    const p = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '吴九', gender: 'FEMALE', phone: '13600136666' });
    patientId = p.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/treatments 创建治疗计划', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/treatments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId,
        code: 'D1110',
        name: '树脂补牙',
        category: '修复',
        price: 300,
        teethNumbers: [16, 17],
      });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.status).toBe('PLANNED');
    expect(res.body.teethNumbers).toEqual([16, 17]);
    expect(Number(res.body.price)).toBe(300);
    treatmentId = res.body.id;
  });

  it('GET 按患者查询治疗记录', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/treatments?patientId=${patientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBe(1);
  });

  it('GET 按牙位查询治疗记录（teethNumbers has 16）', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/treatments?patientId=${patientId}&toothNumber=16`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(1);
  });

  it('GET 按未涉及的牙位查询返回空（toothNumber=11）', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/treatments?patientId=${patientId}&toothNumber=11`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(0);
  });

  it('GET /api/treatments/:id 详情', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/treatments/${treatmentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(treatmentId);
  });

  it('PATCH 状态流转 PLANNED -> APPROVED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/treatments/${treatmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'APPROVED' });
    expect(res.body.status).toBe('APPROVED');
  });

  it('PATCH 状态流转 APPROVED -> IN_PROGRESS', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/treatments/${treatmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' });
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('PATCH 状态流转 IN_PROGRESS -> COMPLETED 自动写 completedDate', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/treatments/${treatmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' });
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.completedDate).toBeDefined();
  });

  it('PATCH 非法状态流转 COMPLETED -> IN_PROGRESS 返回 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/treatments/${treatmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('未带 token 返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/treatments');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
```

- [ ] **Step 9: 运行全部 e2e 测试**

```bash
cd apps/api; pnpm test:e2e
```

预期：patients / appointments / visits / tooth-records / treatments 全部通过。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/treatments apps/api/src/app.module.ts apps/api/test/treatments.e2e-spec.ts; git commit -m "feat(api): add treatments module with status flow and tooth filter query"
```

---

## Task 6: 前端牙位图组件（核心创新）

**Files:**
- Create: `apps/web/src/lib/tooth-constants.ts`
- Create: `apps/web/src/components/tooth/ToothChart.tsx`
- Create: `apps/web/src/modules/tooth/ToothChartDemo.tsx`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 1: 创建 tooth-constants.ts（FDI 编号 + 状态颜色 + 条件映射）**

创建 `apps/web/src/lib/tooth-constants.ts`：

```typescript
// FDI 牙位编号常量（32 颗恒牙）
// 上排（从左到右）：右上象限 18-11 + 左上象限 21-28
// 下排（从左到右）：右下象限 48-41 + 左下象限 31-38
export const UPPER_TEETH = [
  18, 17, 16, 15, 14, 13, 12, 11,
  21, 22, 23, 24, 25, 26, 27, 28,
];

export const LOWER_TEETH = [
  48, 47, 46, 45, 44, 43, 42, 41,
  31, 32, 33, 34, 35, 36, 37, 38,
];

export const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH];

// 牙位状态颜色映射（背景色 / 文字色）
export const TOOTH_STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  SOUND:      { bg: '#FFFFFF', text: '#1C1917', label: '健康' },
  FILLED:     { bg: '#3B82F6', text: '#FFFFFF', label: '已补' },
  DECAYED:    { bg: '#EF4444', text: '#FFFFFF', label: '龋齿' },
  CROWNED:    { bg: '#F59E0B', text: '#FFFFFF', label: '已冠' },
  MISSING:    { bg: '#9CA3AF', text: '#FFFFFF', label: '缺失' },
  ROOT_CANAL: { bg: '#8B5CF6', text: '#FFFFFF', label: '根管' },
  EXTRACTED:  { bg: '#4B5563', text: '#FFFFFF', label: '已拔' },
  IMPLANT:    { bg: '#10B981', text: '#FFFFFF', label: '种植' },
  BRIDGE:     { bg: '#06B6D4', text: '#FFFFFF', label: '桥体' },
};

// 牙位条件角标映射（条件 -> 角标颜色）
export const TOOTH_CONDITION_DOT: Record<string, string> = {
  DECAY: '#EF4444',
  FILLING: '#3B82F6',
  CROWN: '#F59E0B',
  BRIDGE: '#06B6D4',
  IMPLANT: '#10B981',
  ROOT_CANAL: '#8B5CF6',
  EXTRACTION: '#4B5563',
  MOBILITY: '#F97316',
  CALCULUS: '#84CC16',
  BLEEDING: '#EC4899',
  FURCATION: '#A855F7',
  OTHER: '#6B7280',
};

// 象限名称
export const QUADRANT_LABELS: Record<string, string> = {
  upperRight: '上颌右',
  upperLeft: '上颌左',
  lowerRight: '下颌右',
  lowerLeft: '下颌左',
};
```

- [ ] **Step 2: 创建 ToothChart.tsx（SVG 32 颗牙）**

创建 `apps/web/src/components/tooth/ToothChart.tsx`：

```tsx
import { memo } from 'react';
import { UPPER_TEETH, LOWER_TEETH, TOOTH_STATUS_COLOR, TOOTH_CONDITION_DOT } from '@/lib/tooth-constants';

export interface ToothRecord {
  id: string;
  toothNumber: number;
  currentStatus: string;
  conditions: string[];
  remark?: string;
}

interface Props {
  teeth: ToothRecord[];
  selectedTooth?: number;
  onSelectTooth?: (toothNumber: number) => void;
}

const TOOTH_W = 40;
const TOOTH_H = 50;
const GAP = 4;
const CELL = TOOTH_W + GAP; // 44
const MARGIN = 10;
const CENTER_GAP = 20;
const UPPER_Y = 10;
const LOWER_Y = 90;
const SVG_W = MARGIN * 2 + 16 * CELL + CENTER_GAP; // 10 + 704 + 20 + 10 = 744
const SVG_H = 160;
const DIVIDER_X = MARGIN + 8 * CELL + CENTER_GAP / 2; // 372

function toothX(index: number): number {
  if (index < 8) return MARGIN + index * CELL;
  return MARGIN + 8 * CELL + CENTER_GAP + (index - 8) * CELL;
}

interface ToothProps {
  toothNumber: number;
  x: number;
  y: number;
  record?: ToothRecord;
  selected: boolean;
  onSelect?: (n: number) => void;
}

const Tooth = memo(function Tooth({ toothNumber, x, y, record, selected, onSelect }: ToothProps) {
  const status = record?.currentStatus ?? 'SOUND';
  const color = TOOTH_STATUS_COLOR[status] ?? TOOTH_STATUS_COLOR.SOUND;
  const conditions = record?.conditions ?? [];

  return (
    <g
      transform={`translate(${x}, ${y})`}
      className="cursor-pointer"
      onClick={() => onSelect?.(toothNumber)}
    >
      <rect
        width={TOOTH_W}
        height={TOOTH_H}
        rx={6}
        ry={6}
        fill={color.bg}
        stroke={selected ? '#0F766E' : '#E7E5E4'}
        strokeWidth={selected ? 2.5 : 1}
      />
      <text
        x={TOOTH_W / 2}
        y={TOOTH_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        fontWeight={600}
        fill={color.text}
      >
        {toothNumber}
      </text>
      {/* 条件角标：右上角小圆点，最多显示 3 个 */}
      {conditions.slice(0, 3).map((c, i) => (
        <circle
          key={c}
          cx={TOOTH_W - 5 - i * 7}
          cy={5}
          r={3}
          fill={TOOTH_CONDITION_DOT[c] ?? '#6B7280'}
          stroke="#FFFFFF"
          strokeWidth={0.5}
        />
      ))}
      {/* 缺失/已拔：画叉号 */}
      {(status === 'MISSING' || status === 'EXTRACTED') && (
        <>
          <line x1={4} y1={4} x2={TOOTH_W - 4} y2={TOOTH_H - 4} stroke="#FFFFFF" strokeWidth={1.5} opacity={0.6} />
          <line x1={TOOTH_W - 4} y1={4} x2={4} y2={TOOTH_H - 4} stroke="#FFFFFF" strokeWidth={1.5} opacity={0.6} />
        </>
      )}
    </g>
  );
});

export const ToothChart = memo(function ToothChart({ teeth, selectedTooth, onSelectTooth }: Props) {
  const recordMap = new Map<number, ToothRecord>();
  for (const t of teeth) recordMap.set(t.toothNumber, t);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full max-w-[744px] mx-auto"
        style={{ minWidth: 600 }}
      >
        {/* 中线（上下牙分界） */}
        <line x1={MARGIN} y1={(UPPER_Y + TOOTH_H + LOWER_Y) / 2} x2={SVG_W - MARGIN} y2={(UPPER_Y + TOOTH_H + LOWER_Y) / 2} stroke="#D6D3D1" strokeWidth={1} strokeDasharray="4 2" />
        {/* 上下颌标签 */}
        <text x={4} y={UPPER_Y + TOOTH_H / 2} dominantBaseline="central" fontSize={10} fill="#78716C">上</text>
        <text x={4} y={LOWER_Y + TOOTH_H / 2} dominantBaseline="central" fontSize={10} fill="#78716C">下</text>
        {/* 中线分隔（左右象限） */}
        <line x1={DIVIDER_X} y1={4} x2={DIVIDER_X} y2={SVG_H - 4} stroke="#D6D3D1" strokeWidth={1} />

        {/* 上排牙齿 */}
        {UPPER_TEETH.map((n, i) => (
          <Tooth
            key={`u-${n}`}
            toothNumber={n}
            x={toothX(i)}
            y={UPPER_Y}
            record={recordMap.get(n)}
            selected={selectedTooth === n}
            onSelect={onSelectTooth}
          />
        ))}

        {/* 下排牙齿 */}
        {LOWER_TEETH.map((n, i) => (
          <Tooth
            key={`l-${n}`}
            toothNumber={n}
            x={toothX(i)}
            y={LOWER_Y}
            record={recordMap.get(n)}
            selected={selectedTooth === n}
            onSelect={onSelectTooth}
          />
        ))}
      </svg>
    </div>
  );
});
```

- [ ] **Step 3: 创建演示页 ToothChartDemo.tsx**

创建 `apps/web/src/modules/tooth/ToothChartDemo.tsx`：

```tsx
import { useState } from 'react';
import { ToothChart, type ToothRecord } from '@/components/tooth/ToothChart';

const DEMO_TEETH: ToothRecord[] = [
  { id: '1', toothNumber: 16, currentStatus: 'DECAYED', conditions: ['DECAY'] },
  { id: '2', toothNumber: 11, currentStatus: 'FILLED', conditions: ['FILLING'] },
  { id: '3', toothNumber: 21, currentStatus: 'CROWNED', conditions: ['CROWN'] },
  { id: '4', toothNumber: 36, currentStatus: 'ROOT_CANAL', conditions: ['ROOT_CANAL'] },
  { id: '5', toothNumber: 46, currentStatus: 'MISSING', conditions: [] },
  { id: '6', toothNumber: 17, currentStatus: 'IMPLANT', conditions: ['IMPLANT'] },
  { id: '7', toothNumber: 24, currentStatus: 'EXTRACTED', conditions: ['EXTRACTION'] },
];

export default function ToothChartDemo() {
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const tooth = DEMO_TEETH.find((t) => t.toothNumber === selected);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">牙位图组件演示</h1>
      <div className="rounded-lg border border-border bg-white p-6">
        <ToothChart
          teeth={DEMO_TEETH}
          selectedTooth={selected}
          onSelectTooth={setSelected}
        />
      </div>
      <div className="rounded-lg border border-border bg-white p-4">
        <h2 className="text-sm font-medium mb-2">图例</h2>
        <div className="flex flex-wrap gap-3 text-xs">
          {[
            { c: '#FFFFFF', l: '健康', t: '#1C1917' },
            { c: '#3B82F6', l: '已补', t: '#FFFFFF' },
            { c: '#EF4444', l: '龋齿', t: '#FFFFFF' },
            { c: '#F59E0B', l: '已冠', t: '#FFFFFF' },
            { c: '#9CA3AF', l: '缺失', t: '#FFFFFF' },
            { c: '#8B5CF6', l: '根管', t: '#FFFFFF' },
            { c: '#4B5563', l: '已拔', t: '#FFFFFF' },
            { c: '#10B981', l: '种植', t: '#FFFFFF' },
          ].map((x) => (
            <div key={x.l} className="flex items-center gap-1.5">
              <span className="inline-block h-4 w-4 rounded border border-border" style={{ backgroundColor: x.c }} />
              <span>{x.l}</span>
            </div>
          ))}
        </div>
      </div>
      {selected && (
        <div className="rounded-lg border border-primary bg-primary/5 p-4">
          <p className="text-sm">
            已选牙位：<span className="font-mono font-semibold text-primary">{selected}</span>
            {tooth && (
              <span className="ml-3 text-muted-foreground">
                状态：{tooth.currentStatus} · 条件：{tooth.conditions.join(', ') || '无'}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 添加演示页路由**

修改 `apps/web/src/routes/index.tsx`，加入 demo 路由：

```tsx
import { Navigate } from 'react-router-dom';
import LoginPage from '@/modules/auth/LoginPage';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import PatientListPage from '@/modules/patient/PatientListPage';
import PatientDetailPage from '@/modules/patient/PatientDetailPage';
import ToothChartDemo from '@/modules/tooth/ToothChartDemo';

export const routes = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/patients" replace /> },
      { path: 'patients', element: <PatientListPage /> },
      { path: 'patients/:id', element: <PatientDetailPage /> },
      { path: 'tooth-demo', element: <ToothChartDemo /> },
    ],
  },
];
```

- [ ] **Step 5: 启动前端验证渲染**

```bash
cd apps/web; pnpm dev
```

浏览器访问 `http://localhost:5173/tooth-demo`（需先登录），确认：
- 上下两排各 16 颗牙正确渲染，编号符合 FDI
- 16 号牙红色（龋齿）、11 号牙蓝色（已补）、46 号牙灰色叉号（缺失）
- 点击牙齿有蓝色描边高亮，下方显示选中信息
- 中线分隔上下颌与左右象限

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/tooth-constants.ts apps/web/src/components/tooth apps/web/src/modules/tooth apps/web/src/routes/index.tsx; git commit -m "feat(web): add SVG ToothChart component with FDI layout and status colors"
```

---

## Task 7: 前端预约日历页

**Files:**
- Create: `apps/web/src/lib/appointments.ts`
- Create: `apps/web/src/modules/appointment/AppointmentCalendarPage.tsx`
- Create: `apps/web/src/modules/appointment/AppointmentForm.tsx`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 1: 创建 appointments.ts（API hooks）**

创建 `apps/web/src/lib/appointments.ts`：

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  startTime: string;
  endTime: string;
  status: 'BOOKED' | 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  type: 'FIRST_VISIT' | 'RETURN' | 'CONSULTATION' | 'EMERGENCY' | 'RECALL';
  remark?: string;
  patient: { id: string; name: string; code: string; phone: string };
  doctor: { id: string; name: string };
  visit?: { id: string } | null;
}

export interface AppointmentListRes {
  items: Appointment[];
  total: number;
  page: number;
  pageSize: number;
}

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '失约',
};

export const APPOINTMENT_STATUS_COLOR: Record<string, string> = {
  BOOKED: 'bg-primary/10 text-primary border-primary/30',
  ARRIVED: 'bg-warning/10 text-warning border-warning/30',
  IN_CHAIR: 'bg-warning/20 text-warning border-warning/40',
  COMPLETED: 'bg-success/10 text-success border-success/30',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  NO_SHOW: 'bg-destructive/10 text-destructive border-destructive/30',
};

export const APPOINTMENT_TYPE_LABEL: Record<string, string> = {
  FIRST_VISIT: '初诊',
  RETURN: '复诊',
  CONSULTATION: '咨询',
  EMERGENCY: '急诊',
  RECALL: '回访',
};

export function useAppointments(params: {
  doctorId?: string;
  patientId?: string;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ['appointments', params],
    queryFn: async () =>
      (await api.get<AppointmentListRes>('/appointments', {
        params: { ...params, pageSize: 200 },
      })).data,
  });
}

export function useCreateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post<Appointment>('/appointments', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}

export function useUpdateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.patch<Appointment>(`/appointments/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}
```

- [ ] **Step 2: 创建 AppointmentForm.tsx（新建预约弹窗内容）**

创建 `apps/web/src/modules/appointment/AppointmentForm.tsx`：

```tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCreateAppointment } from '@/lib/appointments';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Props {
  defaultStartTime: string; // ISO
  defaultEndTime: string; // ISO
  onClose: () => void;
}

interface Doctor { id: string; name: string; role: string; }

export default function AppointmentForm({ defaultStartTime, defaultEndTime, onClose }: Props) {
  const create = useCreateAppointment();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      patientId: '',
      doctorId: '',
      startTime: defaultStartTime.slice(0, 16),
      endTime: defaultEndTime.slice(0, 16),
      type: 'FIRST_VISIT',
      remark: '',
    },
  });
  const [patientKeyword, setPatientKeyword] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(null);

  const { data: patients } = useQuery({
    queryKey: ['patients', patientKeyword, 1],
    queryFn: async () =>
      (await api.get<{ items: { id: string; name: string; phone: string; code: string }[] }>('/patients', {
        params: { keyword: patientKeyword, page: 1, pageSize: 10 },
      })).data,
    enabled: patientKeyword.length > 0,
  });

  const { data: doctors } = useQuery({
    queryKey: ['doctors'],
    queryFn: async () =>
      (await api.get<Doctor[]>('/auth/users', { params: { role: 'DOCTOR' } })).data,
  });

  const onSubmit = async (data: any) => {
    const payload = {
      ...data,
      patientId: selectedPatient?.id ?? data.patientId,
      startTime: new Date(data.startTime).toISOString(),
      endTime: new Date(data.endTime).toISOString(),
      remark: data.remark || undefined,
    };
    await create.mutateAsync(payload);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label>患者 *</Label>
        {selectedPatient ? (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">{selectedPatient.name}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedPatient(null)}>更换</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input placeholder="姓名 / 手机 / 病历号" value={patientKeyword} onChange={(e) => setPatientKeyword(e.target.value)} />
            {patients && patients.items.length > 0 && (
              <div className="rounded-md border border-border max-h-40 overflow-auto">
                {patients.items.map((p) => (
                  <div
                    key={p.id}
                    className="cursor-pointer px-3 py-1.5 text-sm hover:bg-muted"
                    onClick={() => { setSelectedPatient({ id: p.id, name: p.name }); setPatientKeyword(''); }}
                  >
                    {p.name} · {p.phone} · {p.code}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>医生 *</Label>
          <Select {...register('doctorId', { required: '必填' })}>
            <option value="">请选择</option>
            {doctors?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
          {errors.doctorId && <p className="text-xs text-destructive">{errors.doctorId.message as string}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>类型</Label>
          <Select {...register('type')}>
            <option value="FIRST_VISIT">初诊</option>
            <option value="RETURN">复诊</option>
            <option value="CONSULTATION">咨询</option>
            <option value="EMERGENCY">急诊</option>
            <option value="RECALL">回访</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>开始时间 *</Label>
          <Input type="datetime-local" {...register('startTime', { required: '必填' })} />
        </div>
        <div className="space-y-1.5">
          <Label>结束时间 *</Label>
          <Input type="datetime-local" {...register('endTime', { required: '必填' })} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>备注</Label>
        <Input {...register('remark')} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={create.isPending || !selectedPatient}>保存</Button>
      </div>
    </form>
  );
}
```

> 说明：`GET /users?role=DOCTOR` 需要后端支持。若 Phase 1 的 auth 模块没有 users 列表接口，在 `apps/api/src/modules/auth/auth.controller.ts` 追加以下端点：

```typescript
@Get('users')
@UseGuards(JwtAuthGuard)
findUsers(@Query('role') role?: string) {
  return this.prisma.user.findMany({
    where: role ? { role: role as any } : undefined,
    select: { id: true, name: true, role: true, username: true },
  });
}
```

并在 `auth.controller.ts` 顶部引入 `Get, Query`，注入 `PrismaService`。如果 `auth.controller.ts` 已注入 prisma 则直接使用。此改动较小，归入本 Task 提交。

- [ ] **Step 3: 创建 AppointmentCalendarPage.tsx（周视图）**

创建 `apps/web/src/modules/appointment/AppointmentCalendarPage.tsx`：

```tsx
import { useState, useMemo } from 'react';
import {
  startOfWeek,
  addDays,
  format,
  isSameDay,
  parseISO,
  addWeeks,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import {
  useAppointments,
  useUpdateAppointment,
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_COLOR,
  APPOINTMENT_TYPE_LABEL,
  type Appointment,
} from '@/lib/appointments';
import AppointmentForm from './AppointmentForm';

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8:00 - 18:00
const HOUR_H = 48; // 每小时行高 px

export default function AppointmentCalendarPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSlot, setCreateSlot] = useState<{ start: string; end: string }>({ start: '', end: '' });

  const weekStart = useMemo(
    () => startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 }),
    [weekOffset],
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const { data, isLoading } = useAppointments({
    startDate: format(weekStart, "yyyy-MM-dd'T'00:00:00xxx"),
    endDate: format(addDays(weekStart, 7), "yyyy-MM-dd'T'00:00:00xxx"),
  });

  const update = useUpdateAppointment();
  const appointments = data?.items ?? [];

  // 按天分组
  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = format(parseISO(a.startTime), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [appointments]);

  function calcTop(startISO: string): number {
    const d = parseISO(startISO);
    const h = d.getHours() + d.getMinutes() / 60;
    return (h - 8) * HOUR_H;
  }
  function calcHeight(startISO: string, endISO: string): number {
    const s = parseISO(startISO);
    const e = parseISO(endISO);
    return ((e.getTime() - s.getTime()) / 3600000) * HOUR_H;
  }

  function handleCellClick(day: Date, hour: number) {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(start.getMinutes() + 30);
    setCreateSlot({ start: start.toISOString(), end: end.toISOString() });
    setCreateOpen(true);
  }

  function cycleStatus(a: Appointment) {
    const order: Appointment['status'][] = ['BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED'];
    const idx = order.indexOf(a.status);
    if (idx >= 0 && idx < order.length - 1) {
      update.mutate({ id: a.id, data: { status: order[idx + 1] } });
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">预约日历</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>今天</Button>
          <Button variant="outline" size="icon" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[180px] text-center">
            {format(weekStart, 'yyyy-MM-dd', { locale: zhCN })} ~ {format(addDays(weekStart, 6), 'yyyy-MM-dd', { locale: zhCN })}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white overflow-x-auto">
        <div className="min-w-[900px]">
          {/* 表头：星期 */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
            <div className="p-2 text-xs text-muted-foreground text-right">时间</div>
            {weekDays.map((d) => {
              const isToday = isSameDay(d, new Date());
              return (
                <div
                  key={d.toISOString()}
                  className={`p-2 text-center border-l border-border ${isToday ? 'bg-primary/5' : ''}`}
                >
                  <div className="text-xs text-muted-foreground">{format(d, 'EEE', { locale: zhCN })}</div>
                  <div className={`text-sm font-medium ${isToday ? 'text-primary' : ''}`}>{format(d, 'd')}</div>
                </div>
              );
            })}
          </div>

          {/* 时间格 + 预约卡片 */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
            {/* 时间列 */}
            <div className="border-r border-border">
              {HOURS.map((h) => (
                <div key={h} className="text-xs text-muted-foreground text-right pr-2" style={{ height: HOUR_H }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* 每天一列 */}
            {weekDays.map((d) => {
              const key = format(d, 'yyyy-MM-dd');
              const dayAppts = apptsByDay.get(key) ?? [];
              return (
                <div key={key} className="relative border-l border-border" style={{ height: HOURS.length * HOUR_H }}>
                  {/* 空白格子 */}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="border-b border-border hover:bg-muted/50 cursor-pointer"
                      style={{ height: HOUR_H }}
                      onClick={() => handleCellClick(d, h)}
                    />
                  ))}
                  {/* 预约卡片 */}
                  {dayAppts.map((a) => {
                    const top = calcTop(a.startTime);
                    const height = Math.max(calcHeight(a.startTime, a.endTime), 24);
                    return (
                      <div
                        key={a.id}
                        className={`absolute left-1 right-1 rounded border px-1.5 py-1 text-xs cursor-pointer overflow-hidden ${APPOINTMENT_STATUS_COLOR[a.status]}`}
                        style={{ top, height }}
                        onClick={(e) => { e.stopPropagation(); cycleStatus(a); }}
                        title={`${a.patient.name} - ${APPOINTMENT_STATUS_LABEL[a.status]}（点击切换状态）`}
                      >
                        <div className="font-medium truncate">{a.patient.name}</div>
                        <div className="truncate opacity-80">
                          {format(parseISO(a.startTime), 'HH:mm')} {APPOINTMENT_TYPE_LABEL[a.type]}
                        </div>
                        <div className="truncate opacity-60">{APPOINTMENT_STATUS_LABEL[a.status]}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}

      <div className="flex justify-end">
        <Button onClick={() => {
          const now = new Date();
          now.setMinutes(0, 0, 0);
          const end = new Date(now);
          end.setMinutes(now.getMinutes() + 30);
          setCreateSlot({ start: now.toISOString(), end: end.toISOString() });
          setCreateOpen(true);
        }}>
          <Plus className="h-4 w-4 mr-1" />新建预约
        </Button>
      </div>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogHeader><DialogTitle>新建预约</DialogTitle></DialogHeader>
        <DialogContent>
          <AppointmentForm
            defaultStartTime={createSlot.start}
            defaultEndTime={createSlot.end}
            onClose={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: 添加路由**

修改 `apps/web/src/routes/index.tsx`，导入并加入 `/appointments` 路由：

```tsx
import { Navigate } from 'react-router-dom';
import LoginPage from '@/modules/auth/LoginPage';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import PatientListPage from '@/modules/patient/PatientListPage';
import PatientDetailPage from '@/modules/patient/PatientDetailPage';
import ToothChartDemo from '@/modules/tooth/ToothChartDemo';
import AppointmentCalendarPage from '@/modules/appointment/AppointmentCalendarPage';

export const routes = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/patients" replace /> },
      { path: 'patients', element: <PatientListPage /> },
      { path: 'patients/:id', element: <PatientDetailPage /> },
      { path: 'tooth-demo', element: <ToothChartDemo /> },
      { path: 'appointments', element: <AppointmentCalendarPage /> },
    ],
  },
];
```

- [ ] **Step 5: 验证渲染**

```bash
cd apps/web; pnpm dev
```

浏览器访问 `http://localhost:5173/appointments`（需先登录）：
- 周视图 7 列 × 11 行时间格正确显示
- 点击空白格弹出新建预约表单
- 预约卡片显示患者名、时间、类型、状态，颜色按状态区分
- 点击预约卡片循环切换状态（BOOKED→ARRIVED→IN_CHAIR→COMPLETED）
- 上一周/下一周/今天按钮正常工作

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/appointments.ts apps/web/src/modules/appointment apps/web/src/routes/index.tsx apps/api/src/modules/auth; git commit -m "feat(web): add appointment calendar week view with create and status cycling"
```

---

## Task 8: 前端患者详情页重写（就诊时间轴 + 牙位图联动）

**Files:**
- Create: `apps/web/src/lib/visits.ts`
- Create: `apps/web/src/lib/treatments.ts`
- Create: `apps/web/src/lib/tooth-records.ts`
- Create: `apps/web/src/components/patient/Timeline.tsx`
- Modify: `apps/web/src/modules/patient/PatientDetailPage.tsx`

- [ ] **Step 1: 创建 visits.ts（API hooks）**

创建 `apps/web/src/lib/visits.ts`：

```typescript
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Visit {
  id: string;
  patientId: string;
  appointmentId?: string | null;
  doctorId: string;
  chiefComplaint?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  startTime: string;
  endTime?: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  doctor: { id: string; name: string };
  treatments: { id: string; name: string; status: string; teethNumbers: number[] }[];
}

export interface VisitListRes { items: Visit[]; total: number; }

export function useVisits(patientId: string) {
  return useQuery({
    enabled: !!patientId,
    queryKey: ['visits', patientId],
    queryFn: async () =>
      (await api.get<VisitListRes>('/visits', { params: { patientId, pageSize: 200 } })).data,
  });
}
```

- [ ] **Step 2: 创建 treatments.ts（API hooks）**

创建 `apps/web/src/lib/treatments.ts`：

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Treatment {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: string; // Prisma Decimal 序列化为 string
  quantity: number;
  teethNumbers: number[];
  status: 'PLANNED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  plannedDate?: string | null;
  completedDate?: string | null;
  remark?: string;
  createdAt: string;
  doctor: { id: string; name: string };
  visit?: { id: string } | null;
}

export interface TreatmentListRes { items: Treatment[]; total: number; }

export const TREATMENT_STATUS_LABEL: Record<string, string> = {
  PLANNED: '计划',
  APPROVED: '已确认',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const TREATMENT_STATUS_COLOR: Record<string, string> = {
  PLANNED: 'bg-muted text-muted-foreground',
  APPROVED: 'bg-primary/10 text-primary',
  IN_PROGRESS: 'bg-warning/10 text-warning',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

export function useTreatments(patientId: string, toothNumber?: number) {
  return useQuery({
    enabled: !!patientId,
    queryKey: ['treatments', patientId, toothNumber],
    queryFn: async () =>
      (await api.get<TreatmentListRes>('/treatments', {
        params: { patientId, toothNumber, pageSize: 200 },
      })).data,
  });
}

export function useUpdateTreatment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.patch<Treatment>(`/treatments/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['treatments'] }),
  });
}
```

- [ ] **Step 3: 创建 tooth-records.ts（API hooks）**

创建 `apps/web/src/lib/tooth-records.ts`：

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface ToothRecord {
  id: string;
  patientId: string;
  toothNumber: number;
  currentStatus: string;
  conditions: string[];
  remark?: string;
}

export function useToothRecords(patientId: string) {
  return useQuery({
    enabled: !!patientId,
    queryKey: ['tooth-records', patientId],
    queryFn: async () =>
      (await api.get<ToothRecord[]>('/tooth-records', { params: { patientId } })).data,
  });
}

export function useUpsertTooth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      patientId: string;
      toothNumber: number;
      currentStatus?: string;
      conditions?: string[];
      remark?: string;
    }) => (await api.post<ToothRecord>('/tooth-records', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tooth-records'] }),
  });
}
```

- [ ] **Step 4: 创建 Timeline.tsx（就诊时间轴组件）**

创建 `apps/web/src/components/patient/Timeline.tsx`：

```tsx
import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar, Stethoscope, Pill } from 'lucide-react';
import type { Appointment } from '@/lib/appointments';
import type { Visit } from '@/lib/visits';
import type { Treatment } from '@/lib/treatments';
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_TYPE_LABEL,
} from '@/lib/appointments';
import { TREATMENT_STATUS_LABEL, TREATMENT_STATUS_COLOR } from '@/lib/treatments';
import { Badge } from '@/components/ui/badge';

type TimelineNode =
  | { kind: 'appointment'; time: string; data: Appointment }
  | { kind: 'visit'; time: string; data: Visit }
  | { kind: 'treatment'; time: string; data: Treatment };

interface Props {
  appointments: Appointment[];
  visits: Visit[];
  treatments: Treatment[];
  toothFilter?: number; // 选中牙位过滤（仅影响 treatment 节点）
}

export function Timeline({ appointments, visits, treatments, toothFilter }: Props) {
  const nodes = useMemo<TimelineNode[]>(() => {
    const filteredTreatments = toothFilter
      ? treatments.filter((t) => t.teethNumbers.includes(toothFilter))
      : treatments;

    const apptNodes: TimelineNode[] = appointments.map((a) => ({
      kind: 'appointment',
      time: a.startTime,
      data: a,
    }));
    const visitNodes: TimelineNode[] = visits.map((v) => ({
      kind: 'visit',
      time: v.startTime,
      data: v,
    }));
    const treatNodes: TimelineNode[] = filteredTreatments.map((t) => ({
      kind: 'treatment',
      time: t.createdAt,
      data: t,
    }));

    return [...apptNodes, ...visitNodes, ...treatNodes].sort(
      (a, b) => parseISO(b.time).getTime() - parseISO(a.time).getTime(),
    );
  }, [appointments, visits, treatments, toothFilter]);

  if (nodes.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12 text-sm">
        {toothFilter ? `该牙位暂无治疗记录` : '暂无就诊记录'}
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      {/* 竖线 */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

      {nodes.map((node, i) => {
        const time = parseISO(node.time);
        return (
          <div key={`${node.kind}-${node.data.id}-${i}`} className="relative pb-6 last:pb-0">
            {/* 节点圆点 */}
            <div
              className={`absolute -left-4 top-1 h-3 w-3 rounded-full border-2 border-white ${
                node.kind === 'appointment'
                  ? 'bg-primary'
                  : node.kind === 'visit'
                    ? 'bg-warning'
                    : 'bg-success'
              }`}
            />

            <div className="text-xs text-muted-foreground mb-1">
              {format(time, 'yyyy-MM-dd HH:mm', { locale: zhCN })}
            </div>

            {node.kind === 'appointment' && (
              <div className="rounded-md border border-border bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">预约 · {APPOINTMENT_TYPE_LABEL[node.data.type]}</span>
                  <Badge className="bg-primary/10 text-primary">{APPOINTMENT_STATUS_LABEL[node.data.status]}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {node.data.doctor.name} · {format(parseISO(node.data.startTime), 'HH:mm')}-{format(parseISO(node.data.endTime), 'HH:mm')}
                </div>
              </div>
            )}

            {node.kind === 'visit' && (
              <div className="rounded-md border border-border bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Stethoscope className="h-4 w-4 text-warning" />
                  <span className="font-medium text-sm">就诊 · {node.data.doctor.name}</span>
                  <Badge className={node.data.status === 'COMPLETED' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
                    {node.data.status === 'COMPLETED' ? '已完成' : '进行中'}
                  </Badge>
                </div>
                {node.data.chiefComplaint && (
                  <div className="text-xs text-muted-foreground">主诉：{node.data.chiefComplaint}</div>
                )}
                {node.data.diagnosis && (
                  <div className="text-xs text-muted-foreground">诊断：{node.data.diagnosis}</div>
                )}
                {node.data.treatments.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    治疗：{node.data.treatments.map((t) => t.name).join('、')}
                  </div>
                )}
              </div>
            )}

            {node.kind === 'treatment' && (
              <div className="rounded-md border border-border bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Pill className="h-4 w-4 text-success" />
                  <span className="font-medium text-sm">治疗 · {node.data.name}</span>
                  <Badge className={TREATMENT_STATUS_COLOR[node.data.status]}>
                    {TREATMENT_STATUS_LABEL[node.data.status]}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {node.data.doctor.name} · {node.data.category} · ¥{Number(node.data.price)}
                  {node.data.teethNumbers.length > 0 && (
                    <span> · 牙位：{node.data.teethNumbers.join(', ')}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: 重写 PatientDetailPage.tsx（左：信息卡+牙位图过滤器，右：时间轴，顶部 Tab）**

将 `apps/web/src/modules/patient/PatientDetailPage.tsx` 完整替换为：

```tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ToothChart } from '@/components/tooth/ToothChart';
import { Timeline } from '@/components/patient/Timeline';
import { usePatient } from '@/lib/patients';
import { useAppointments } from '@/lib/appointments';
import { useVisits } from '@/lib/visits';
import { useTreatments } from '@/lib/treatments';
import { useToothRecords } from '@/lib/tooth-records';
import { formatDate } from '@/lib/utils';
import { APPOINTMENT_STATUS_LABEL } from '@/lib/appointments';

type Tab = 'timeline' | 'tooth' | 'appointments';

export default function PatientDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('timeline');
  const [selectedTooth, setSelectedTooth] = useState<number | undefined>(undefined);

  const { data: patient } = usePatient(id);
  const { data: apptData } = useAppointments({ patientId: id });
  const { data: visitData } = useVisits(id);
  const { data: treatmentData } = useTreatments(id);
  const { data: teeth } = useToothRecords(id);

  const appointments = apptData?.items ?? [];
  const visits = visitData?.items ?? [];
  const treatments = treatmentData?.items ?? [];

  const genderText = (g?: string) =>
    ({ MALE: '男', FEMALE: '女', UNKNOWN: '未知' } as Record<string, string>)[g ?? ''] ?? g;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'timeline', label: '就诊时间轴' },
    { key: 'tooth', label: '牙位详情' },
    { key: 'appointments', label: '预约记录' },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => nav('/patients')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">
          {patient?.name ?? '加载中…'}
          {patient && <Badge className="ml-2 bg-muted text-muted-foreground font-mono">{patient.code}</Badge>}
        </h1>
      </div>

      <div className="grid grid-cols-[420px_1fr] gap-6">
        {/* 左侧：患者信息卡 + 牙位图 */}
        <div className="space-y-4">
          {patient && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">性别：</span>{genderText(patient.gender)}</div>
                <div><span className="text-muted-foreground">手机：</span>{patient.phone}</div>
                {patient.birthDate && (
                  <div><span className="text-muted-foreground">生日：</span>{formatDate(patient.birthDate)}</div>
                )}
                <div><span className="text-muted-foreground">建档：</span>{formatDate(patient.createdAt)}</div>
              </div>
              {patient.allergies?.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-destructive text-xs">过敏史：</span>
                  {patient.allergies.map((a) => (
                    <Badge key={a} className="bg-destructive/10 text-destructive">{a}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 牙位图（全局过滤器） */}
          <div className="rounded-lg border border-border bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">牙位图</h2>
              {selectedTooth && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedTooth(undefined)}>
                  清除筛选（牙位 {selectedTooth}）
                </Button>
              )}
            </div>
            <ToothChart
              teeth={teeth ?? []}
              selectedTooth={selectedTooth}
              onSelectTooth={(n) => setSelectedTooth((prev) => (prev === n ? undefined : n))}
            />
            <p className="text-xs text-muted-foreground mt-2">
              {selectedTooth
                ? `已选牙位 ${selectedTooth}，右侧时间轴已过滤为该牙的治疗记录`
                : '点击牙位筛选右侧时间轴'}
            </p>
          </div>
        </div>

        {/* 右侧：Tab + 时间轴 */}
        <div className="space-y-4">
          <div className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            <div className="rounded-lg border border-border bg-white p-4">
              {selectedTooth && (
                <div className="mb-3 rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
                  时间轴已按牙位 {selectedTooth} 过滤治疗记录
                </div>
              )}
              <Timeline
                appointments={appointments}
                visits={visits}
                treatments={treatments}
                toothFilter={selectedTooth}
              />
            </div>
          )}

          {tab === 'tooth' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-2">
              <h2 className="text-sm font-medium mb-2">牙位记录详情</h2>
              {(teeth ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无牙位记录</p>
              ) : (
                (teeth ?? []).map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold w-8">{t.toothNumber}</span>
                      <Badge className="bg-muted text-muted-foreground">{t.currentStatus}</Badge>
                      {t.conditions.map((c) => (
                        <Badge key={c} className="bg-primary/10 text-primary">{c}</Badge>
                      ))}
                    </div>
                    {t.remark && <span className="text-xs text-muted-foreground">{t.remark}</span>}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'appointments' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-2">
              <h2 className="text-sm font-medium mb-2">预约记录</h2>
              {appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无预约</p>
              ) : (
                appointments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{a.doctor.name} · {a.type}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(a.startTime)} {new Date(a.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <Badge className="bg-primary/10 text-primary">{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 验证页面渲染**

```bash
cd apps/web; pnpm dev
```

浏览器操作：
1. 进入患者列表 → 点击任一患者 → 进入详情页
2. 左侧显示患者信息卡 + 牙位图（32 颗牙）
3. 右侧默认显示"就诊时间轴" Tab，时间倒序排列预约/就诊/治疗节点
4. 点击牙位图某颗牙 → 右侧时间轴过滤为该牙的治疗记录，顶部提示"已按牙位 N 过滤"
5. 再次点击同一牙 → 取消筛选
6. 切换"牙位详情" Tab → 看到所有牙位记录列表
7. 切换"预约记录" Tab → 看到该患者所有预约
8. 返回按钮回到患者列表

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/lib/visits.ts apps/web/src/lib/treatments.ts apps/web/src/lib/tooth-records.ts apps/web/src/components/patient apps/web/src/modules/patient/PatientDetailPage.tsx; git commit -m "feat(web): rewrite patient detail page with tooth chart filter and visit timeline"
```

---

# 自检清单

## 1. Spec 覆盖

| 原 Phase 2 概要条目 | 对应 Task |
|---------------------|-----------|
| 数据库加入 Appointment / Visit / ToothRecord / Treatment model | Task 1 ✅ |
| 后端 appointments CRUD + 到诊状态机 | Task 2 ✅ |
| 后端 visits | Task 3 ✅ |
| 后端 tooth-records | Task 4 ✅ |
| 后端 treatments | Task 5 ✅ |
| 前端预约日历页（周视图，拖拽改时间） | Task 7 ✅（周视图 + 点击空白格新建 + 点击卡片改状态；拖拽改时间作为后续增强，当前用 PATCH startTime/endTime 接口已具备能力） |
| 患者详情页重写：就诊时间轴组件 | Task 8 ✅ |
| 牙位图组件（SVG 32 颗牙，点击选中、状态着色） | Task 6 ✅ |
| 牙位图作为全局过滤器：选中牙位 → 联动显示治疗历史 | Task 8 ✅ |
| seed 扩展：治疗项目字典 | Task 1 ✅ |
| seed 扩展：医生排班 | Task 1 ✅ |

**注：** 原概要提到"拖拽改时间"，当前 Task 7 实现"点击空白格新建 + 点击卡片循环切换状态"。拖拽改时间需引入 dnd-kit 等库，超出当前范围；后端 PATCH 接口已支持改时间，前端可在后续迭代加拖拽。这是需要主会话决策的一个简化点。

## 2. Placeholder 扫描

已全文检查，无 TODO / TBD / "类似 Task N" / "添加错误处理" 等占位符。每个步骤均含完整代码块或精确命令。

## 3. 类型一致性

前后端字段名对照检查通过：

| 字段 | 后端（Prisma / DTO） | 前端（TS interface） | 一致 |
|------|---------------------|---------------------|------|
| Appointment.startTime / endTime | DateTime → ISO string 序列化 | `string` | ✅ |
| Appointment.status | `AppointmentStatus` enum | 联合字面量类型 | ✅ |
| Appointment.type | `AppointmentType` enum | 联合字面量类型 | ✅ |
| Visit.chiefComplaint / diagnosis / treatmentPlan | `String?` | `string?` | ✅ |
| Visit.status | `VisitStatus` enum | `'IN_PROGRESS' \| 'COMPLETED'` | ✅ |
| ToothRecord.toothNumber | `Int` | `number` | ✅ |
| ToothRecord.currentStatus | `ToothStatus` enum | `string` | ✅ |
| ToothRecord.conditions | `ToothCondition[]` | `string[]` | ✅ |
| Treatment.price | `Decimal` → JSON 序列化为 `string` | `string`（前端 `Number(price)`） | ✅ |
| Treatment.teethNumbers | `Int[]` | `number[]` | ✅ |
| Treatment.status | `TreatmentStatus` enum | 联合字面量类型 | ✅ |

**枚举值一致性：** 前端 TS 联合字面量与后端 Prisma 枚举值逐一对照，全部匹配（BOOKED/ARRIVED/IN_CHAIR/COMPLETED/CANCELLED/NO_SHOW 等）。

## 4. 需要主会话决策的疑点

1. **拖拽改时间：** 原 Phase 2 概要提到"拖拽改时间"，当前 Task 7 用"点击空白格新建 + 点击卡片循环切换状态"替代。后端 PATCH 接口已支持改时间（含冲突检测）。如需拖拽，需引入 `@dnd-kit/core` 等库，建议作为 Phase 2.1 增量。请确认是否接受当前简化。

2. **TreatmentCatalog / DoctorSchedule 辅助 model：** 原 schema 未包含这两个 model，但 seed 需要"治疗项目字典"和"医生排班"落库，故新增。DoctorSchedule 目前仅作为 seed 数据，日历页未直接消费（日历页按全量预约渲染）。如不需要落库，可改为前端常量，请确认。

3. **users 列表接口：** Task 7 的预约表单需要 `GET /api/auth/users?role=DOCTOR` 获取医生列表。Phase 1 的 auth 模块未暴露此接口，Task 7 Step 2 已包含在 `auth.controller.ts` 追加端点的说明。如希望单独拆成 Task，请告知。

4. **Patient 反向关系不含 charges/notes/prescriptions/images：** 按 Phase 2 范围，Patient 仅加了 appointments/teeth/treatments/visits 四个反向关系。Phase 3/4 建表时需补加其余反向字段并追加迁移。
