# Dental Clinic Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现收费、处方、治疗计划三大核心业务闭环，完成诊所日常运营全流程。

**Architecture:** 后端扩展 3 个 NestJS 模块（charges/prescriptions/treatment-plans），前端构建治疗计划聚合/明细双视图、收费收银页、处方打印。

**Tech Stack:** NestJS + Prisma + PostgreSQL / React 18 + TypeScript + Vite + TailwindCSS + @tanstack/react-query + date-fns

---

## Schema 设计说明（Phase 3 范围）

Phase 3 在 Phase 2 基础上新增 3 个核心 model：`Charge / Prescription / TreatmentPlan`，以及 2 个辅助 model：`DrugCatalog`（药品字典）、`ChargeItem`（收费明细表，替代原 schema 的 items Json）。

**对原 schema 的三处修正（原文件 `docs/superpowers/plans/2026-07-16-dental-clinic-mvp.md` 行 310-363）：**

1. `Charge.items Json` 改为 `ChargeItem[]` 关联表 — 明细用 Json 不利于查询和统计，拆成独立表更适合报表聚合。Charge 通过 `items ChargeItem[]` 一对多关联。
2. `Prescription.items Json` 改为 `PrescriptionItem[]` 关联表 — 同理，拆出 PrescriptionItem 便于统计药品消耗。
3. 新增 `TreatmentPlan` model — 治疗计划是独立的业务实体，与 Visit 关联但不等同（治疗计划可以跨多次就诊执行），与 Treatment 通过 `planItems TreatmentPlanItem[]` 关联。

**字段名前后端一致性约定：**

| Model | 关键字段 |
|-------|---------|
| Charge | `id, patientId, visitId, doctorId, number, totalAmount, paidAmount, discount, status, payMethod, paidAt, items, createdAt` |
| ChargeItem | `id, chargeId, treatmentId, name, category, price, quantity, teethNumbers` |
| Prescription | `id, patientId, visitId, doctorId, items, remark, createdAt` |
| PrescriptionItem | `id, prescriptionId, drugName, spec, dosage, frequency, days, quantity` |
| TreatmentPlan | `id, patientId, visitId, doctorId, name, status, totalFee, createdAt, items` |
| TreatmentPlanItem | `id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId` |
| DrugCatalog | `id, code, name, spec, category, price, unit, stock` |

**枚举值：**
```
ChargeStatus: UNPAID | PARTIAL | PAID | REFUNDED
PayMethod: CASH | WECHAT | ALIPAY | UNIONPAY | INSURANCE | OTHER
PlanStatus: DRAFT | APPROVED | IN_PROGRESS | COMPLETED | CANCELLED
PlanItemStatus: PLANNED | IN_PROGRESS | COMPLETED | SKIPPED
```

---

## Task 1: 数据库 schema 扩展 + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: 修改 schema.prisma — 给 User / Patient / Visit 加反向关系字段**

打开 `apps/api/prisma/schema.prisma`，在 `model User` 中追加 3 个反向关系（在 `visits` 行之后）：
```prisma
  charges      Charge[]
  prescriptions Prescription[]
  treatmentPlans TreatmentPlan[]
```

在 `model Patient` 中追加 3 个反向关系（在 `visits` 行之后）：
```prisma
  charges      Charge[]
  prescriptions Prescription[]
  treatmentPlans TreatmentPlan[]
```

在 `model Visit` 中追加 3 个反向关系（在 `treatments` 行之后）：
```prisma
  charges      Charge[]
  prescriptions Prescription[]
  treatmentPlans TreatmentPlan[]
```

- [ ] **Step 2: 在 schema.prisma 末尾追加 Phase 3 全部 model 和枚举**

在 `model Appointment` 定义之后追加：

```prisma
// ============ 收费 ============
model Charge {
  id          String        @id @default(cuid())
  patientId   String
  patient     Patient       @relation(fields: [patientId], references: [id])
  visitId     String?
  visit       Visit?        @relation(fields: [visitId], references: [id])
  doctorId    String?
  doctor      User?         @relation(fields: [doctorId], references: [id])
  number      String        @unique
  totalAmount Decimal       @db.Decimal(10, 2)
  paidAmount  Decimal       @db.Decimal(10, 2) @default(0)
  discount    Decimal       @db.Decimal(10, 2) @default(0)
  status      ChargeStatus  @default(UNPAID)
  payMethod   PayMethod?
  paidAt      DateTime?
  remark      String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  items       ChargeItem[]

  @@index([patientId, status])
  @@index([createdAt])
}

enum ChargeStatus {
  UNPAID
  PARTIAL
  PAID
  REFUNDED
}

enum PayMethod {
  CASH
  WECHAT
  ALIPAY
  UNIONPAY
  INSURANCE
  OTHER
}

model ChargeItem {
  id          String   @id @default(cuid())
  chargeId    String
  charge      Charge   @relation(fields: [chargeId], references: [id], onDelete: Cascade)
  treatmentId String?
  name        String
  category    String
  price       Decimal  @db.Decimal(10, 2)
  quantity    Int      @default(1)
  teethNumbers Int[]
  subtotal    Decimal  @db.Decimal(10, 2)
}

// ============ 处方 ============
model Prescription {
  id          String             @id @default(cuid())
  patientId   String
  patient     Patient            @relation(fields: [patientId], references: [id])
  visitId     String?
  visit       Visit?             @relation(fields: [visitId], references: [id])
  doctorId    String
  doctor      User               @relation(fields: [doctorId], references: [id])
  remark      String?
  createdAt   DateTime           @default(now())

  items       PrescriptionItem[]

  @@index([patientId])
}

model PrescriptionItem {
  id             String  @id @default(cuid())
  prescriptionId String
  prescription   Prescription @relation(fields: [prescriptionId], references: [id], onDelete: Cascade)
  drugCode       String?
  drugName       String
  spec           String
  dosage         String
  frequency      String
  days           Int
  quantity       Decimal @db.Decimal(10, 2)
  unit           String
}

// ============ 治疗计划 ============
model TreatmentPlan {
  id        String     @id @default(cuid())
  patientId String
  patient   Patient    @relation(fields: [patientId], references: [id])
  visitId   String?
  visit     Visit?     @relation(fields: [visitId], references: [id])
  doctorId  String
  doctor    User       @relation(fields: [doctorId], references: [id])
  name      String
  status    PlanStatus @default(DRAFT)
  totalFee  Decimal    @db.Decimal(10, 2) @default(0)
  remark    String?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  items     TreatmentPlanItem[]

  @@index([patientId, status])
}

enum PlanStatus {
  DRAFT
  APPROVED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model TreatmentPlanItem {
  id         String         @id @default(cuid())
  planId     String
  plan       TreatmentPlan  @relation(fields: [planId], references: [id], onDelete: Cascade)
  code       String
  name       String
  category   String
  price      Decimal        @db.Decimal(10, 2)
  quantity   Int            @default(1)
  teethNumbers Int[]
  status     PlanItemStatus @default(PLANNED)
  treatmentId String?
  completedAt DateTime?
  remark     String?

  @@index([planId])
}

enum PlanItemStatus {
  PLANNED
  IN_PROGRESS
  COMPLETED
  SKIPPED
}

// ============ 辅助：药品字典 ============
model DrugCatalog {
  id        String  @id @default(cuid())
  code      String  @unique
  name      String
  spec      String
  category  String
  price     Decimal @db.Decimal(10, 2)
  unit      String
  stock     Decimal @db.Decimal(10, 2) @default(0)
  remark    String?
  createdAt DateTime @default(now())
}
```

- [ ] **Step 3: 运行迁移生成 Prisma Client**

```bash
cd apps/api; pnpm prisma migrate dev --name phase3
```
预期输出：`Applied migration` + `Generated Prisma Client`。

- [ ] **Step 4: 验证 Prisma Client 生成成功**

```bash
cd apps/api; pnpm prisma generate
```

- [ ] **Step 5: 扩展 seed.ts — 药品字典**

在 `apps/api/prisma/seed.ts` 中，治疗项目字典循环之后，追加药品字典 seed：

```typescript
  // ---- 药品字典 ----
  const drugs: Array<{ code: string; name: string; spec: string; category: string; price: number; unit: string; stock: number }> = [
    { code: 'DR001', name: '阿莫西林胶囊', spec: '0.25g*24粒', category: '抗生素', price: 25, unit: '盒', stock: 100 },
    { code: 'DR002', name: '甲硝唑片', spec: '0.2g*100片', category: '抗生素', price: 12, unit: '瓶', stock: 80 },
    { code: 'DR003', name: '布洛芬缓释胶囊', spec: '0.3g*20粒', category: '镇痛', price: 18, unit: '盒', stock: 120 },
    { code: 'DR004', name: '对乙酰氨基酚片', spec: '0.5g*30片', category: '镇痛', price: 8, unit: '盒', stock: 200 },
    { code: 'DR005', name: '氯己定含漱液', spec: '200ml', category: '口腔护理', price: 35, unit: '瓶', stock: 60 },
    { code: 'DR006', name: '糠甾醇片', spec: '40mg*100片', category: '牙周', price: 22, unit: '瓶', stock: 50 },
    { code: 'DR007', name: '维生素C片', spec: '100mg*100片', category: '维生素', price: 6, unit: '瓶', stock: 150 },
  ];
  for (const d of drugs) {
    await prisma.drugCatalog.upsert({
      where: { code: d.code },
      update: {},
      create: d,
    });
  }
```

同时在 seed 末尾的 console.log 追加一行：
```typescript
  console.log(`药品字典: ${drugs.length} 项`);
```

- [ ] **Step 6: 运行 seed 验证**

```bash
cd apps/api; pnpm prisma:seed
```
预期输出包含 "药品字典: 7 项"。

- [ ] **Step 7: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/seed.ts apps/api/prisma/migrations; git commit -m "feat(api): add Charge/Prescription/TreatmentPlan schema + drug catalog seed"
```

---

## Task 2: 后端 charges 模块（收费收银）

**Files:**
- Create: `apps/api/src/modules/charges/charges.module.ts`
- Create: `apps/api/src/modules/charges/charges.controller.ts`
- Create: `apps/api/src/modules/charges/charges.service.ts`
- Create: `apps/api/src/modules/charges/dto/create-charge.dto.ts`
- Create: `apps/api/src/modules/charges/dto/update-charge.dto.ts`
- Create: `apps/api/src/modules/charges/dto/pay-charge.dto.ts`
- Create: `apps/api/src/modules/charges/dto/query-charge.dto.ts`
- Create: `apps/api/test/charges.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 CreateChargeDto**

创建 `apps/api/src/modules/charges/dto/create-charge.dto.ts`：
```typescript
import { IsString, IsEnum, IsOptional, IsArray, ValidateNested, IsNumber, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PayMethod } from '@prisma/client';

export class ChargeItemDto {
  @IsString()
  @IsOptional()
  treatmentId?: string;

  @IsString()
  name!: string;

  @IsString()
  category!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsArray()
  teethNumbers: number[] = [];
}

export class CreateChargeDto {
  @IsString()
  patientId!: string;

  @IsString()
  @IsOptional()
  visitId?: string;

  @IsString()
  @IsOptional()
  doctorId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeItemDto)
  items!: ChargeItemDto[];

  @IsNumber()
  @IsOptional()
  discount?: number;

  @IsEnum(PayMethod)
  @IsOptional()
  payMethod?: PayMethod;

  @IsString()
  @IsOptional()
  remark?: string;
}
```

- [ ] **Step 2: 创建 PayChargeDto**

创建 `apps/api/src/modules/charges/dto/pay-charge.dto.ts`：
```typescript
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { PayMethod } from '@prisma/client';

export class PayChargeDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsEnum(PayMethod)
  payMethod!: PayMethod;

  @IsString()
  @IsOptional()
  remark?: string;
}
```

- [ ] **Step 3: 创建 QueryChargeDto**

创建 `apps/api/src/modules/charges/dto/query-charge.dto.ts`：
```typescript
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ChargeStatus } from '@prisma/client';

export class QueryChargeDto {
  @IsString()
  @IsOptional()
  patientId?: string;

  @IsEnum(ChargeStatus)
  @IsOptional()
  status?: ChargeStatus;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize = 20;
}
```

- [ ] **Step 4: 创建 charges.service.ts**

创建 `apps/api/src/modules/charges/charges.service.ts`：
```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';
import { QueryChargeDto } from './dto/query-charge.dto';
import { ChargeStatus, PayMethod } from '@prisma/client';

@Injectable()
export class ChargesService {
  constructor(private prisma: PrismaService) {}

  private generateNumber(): string {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `CH${ymd}${rand}`;
  }

  async create(dto: CreateChargeDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('收费明细不能为空');
    }

    const subtotals = dto.items.map((item) => item.price * item.quantity);
    const subtotal = subtotals.reduce((a, b) => a + b, 0);
    const discount = dto.discount ?? 0;
    const total = Math.max(0, subtotal - discount);

    const charge = await this.prisma.charge.create({
      data: {
        patientId: dto.patientId,
        visitId: dto.visitId,
        doctorId: dto.doctorId,
        number: this.generateNumber(),
        totalAmount: total,
        discount,
        status: ChargeStatus.UNPAID,
        payMethod: dto.payMethod ?? null,
        remark: dto.remark,
        items: {
          create: dto.items.map((item) => ({
            treatmentId: item.treatmentId ?? null,
            name: item.name,
            category: item.category,
            price: item.price,
            quantity: item.quantity,
            teethNumbers: item.teethNumbers ?? [],
            subtotal: item.price * item.quantity,
          })),
        },
      },
      include: { items: true },
    });
    return charge;
  }

  async findAll(dto: QueryChargeDto) {
    const where: any = {};
    if (dto.patientId) where.patientId = dto.patientId;
    if (dto.status) where.status = dto.status;
    if (dto.startDate && dto.endDate) {
      where.createdAt = { gte: new Date(dto.startDate), lte: new Date(dto.endDate) };
    }

    const [items, total] = await Promise.all([
      this.prisma.charge.findMany({
        where,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          patient: { select: { id: true, name: true, code: true, phone: true } },
          doctor: { select: { id: true, name: true } },
        },
      }),
      this.prisma.charge.count({ where }),
    ]);

    return { items, total, page: dto.page, pageSize: dto.pageSize };
  }

  async findOne(id: string) {
    const charge = await this.prisma.charge.findUnique({
      where: { id },
      include: {
        items: true,
        patient: { select: { id: true, name: true, code: true, phone: true } },
        doctor: { select: { id: true, name: true } },
      },
    });
    if (!charge) throw new NotFoundException('收费单不存在');
    return charge;
  }

  async pay(id: string, dto: PayChargeDto) {
    const charge = await this.findOne(id);
    if (charge.status === ChargeStatus.PAID) {
      throw new BadRequestException('该收费单已完成支付');
    }
    if (charge.status === ChargeStatus.REFUNDED) {
      throw new BadRequestException('已退款的收费单不能再支付');
    }

    const currentPaid = Number(charge.paidAmount);
    const total = Number(charge.totalAmount);
    const newPaid = currentPaid + dto.amount;

    if (newPaid > total + 0.001) {
      throw new BadRequestException('支付金额超过应收金额');
    }

    const newStatus =
      newPaid >= total - 0.001 ? ChargeStatus.PAID : ChargeStatus.PARTIAL;

    const updated = await this.prisma.charge.update({
      where: { id },
      data: {
        paidAmount: newPaid,
        status: newStatus,
        payMethod: dto.payMethod,
        paidAt: newStatus === ChargeStatus.PAID ? new Date() : charge.paidAt,
      },
      include: { items: true },
    });

    return updated;
  }

  async refund(id: string) {
    const charge = await this.findOne(id);
    if (charge.status === ChargeStatus.UNPAID) {
      throw new BadRequestException('未支付的收费单不能退款');
    }
    if (charge.status === ChargeStatus.REFUNDED) {
      throw new BadRequestException('该收费单已退款');
    }

    const refunded = await this.prisma.charge.update({
      where: { id },
      data: { status: ChargeStatus.REFUNDED },
      include: { items: true },
    });
    return refunded;
  }
}
```

- [ ] **Step 5: 创建 charges.controller.ts**

创建 `apps/api/src/modules/charges/charges.controller.ts`：
```typescript
import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';
import { QueryChargeDto } from './dto/query-charge.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('charges')
@UseGuards(JwtAuthGuard)
export class ChargesController {
  constructor(private charges: ChargesService) {}

  @Post()
  create(@Body() dto: CreateChargeDto) {
    return this.charges.create(dto);
  }

  @Get()
  findAll(@Query() dto: QueryChargeDto) {
    return this.charges.findAll(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.charges.findOne(id);
  }

  @Patch(':id/pay')
  pay(@Param('id') id: string, @Body() dto: PayChargeDto) {
    return this.charges.pay(id, dto);
  }

  @Patch(':id/refund')
  refund(@Param('id') id: string) {
    return this.charges.refund(id);
  }
}
```

- [ ] **Step 6: 创建 charges.module.ts**

创建 `apps/api/src/modules/charges/charges.module.ts`：
```typescript
import { Module } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { ChargesController } from './charges.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ChargesService],
  controllers: [ChargesController],
})
export class ChargesModule {}
```

- [ ] **Step 7: 注册到 app.module.ts**

修改 `apps/api/src/app.module.ts`，在 imports 数组中追加 `ChargesModule`。

- [ ] **Step 8: 写 e2e 测试**

创建 `apps/api/test/charges.e2e-spec.ts`：
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

describe('Charges (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let patientId: string;
  let doctorId: string;
  let chargeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.treatment.deleteMany();
    await prisma.chargeItem.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.visit.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.toothRecord.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.user.deleteMany();

    const hash = await bcrypt.hash('123456', 10);
    const doctor = await prisma.user.create({
      data: { username: 'doc_charge', passwordHash: hash, name: '收费测试医生', role: 'DOCTOR' },
    });
    doctorId = doctor.id;
    const patient = await prisma.patient.create({
      data: { code: 'PCHARGE', name: '收费测试患者', gender: 'MALE', phone: '13700000000' },
    });
    patientId = patient.id;

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'doc_charge', password: '123456' });
    token = res.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /charges - 创建收费单', () => {
    return request(app.getHttpServer())
      .post('/charges')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId,
        items: [
          { name: '树脂补牙', category: '修复', price: 300, quantity: 1, teethNumbers: [16] },
          { name: '超声波洁牙', category: '预防', price: 150, quantity: 1, teethNumbers: [] },
        ],
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.patientId).toBe(patientId);
        expect(res.body.totalAmount).toBe('450');
        expect(res.body.status).toBe('UNPAID');
        expect(res.body.items).toHaveLength(2);
        chargeId = res.body.id;
      });
  });

  it('POST /charges - 空明细返回 400', () => {
    return request(app.getHttpServer())
      .post('/charges')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId, items: [] })
      .expect(400);
  });

  it('GET /charges - 分页查询', () => {
    return request(app.getHttpServer())
      .get('/charges')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.items.length).toBe(1);
        expect(res.body.total).toBe(1);
      });
  });

  it('GET /charges/:id - 获取详情', () => {
    return request(app.getHttpServer())
      .get(`/charges/${chargeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.id).toBe(chargeId);
        expect(res.body.items).toHaveLength(2);
        expect(res.body.patient.name).toBe('收费测试患者');
      });
  });

  it('PATCH /charges/:id/pay - 部分支付', () => {
    return request(app.getHttpServer())
      .patch(`/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 200, payMethod: 'WECHAT' })
      .expect(200)
      .expect((res) => {
        expect(res.body.paidAmount).toBe('200');
        expect(res.body.status).toBe('PARTIAL');
      });
  });

  it('PATCH /charges/:id/pay - 付清余款', () => {
    return request(app.getHttpServer())
      .patch(`/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 250, payMethod: 'ALIPAY' })
      .expect(200)
      .expect((res) => {
        expect(res.body.paidAmount).toBe('450');
        expect(res.body.status).toBe('PAID');
      });
  });

  it('PATCH /charges/:id/pay - 超额支付返回 400', () => {
    return request(app.getHttpServer())
      .patch(`/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100, payMethod: 'CASH' })
      .expect(400);
  });

  it('PATCH /charges/:id/refund - 退款', () => {
    return request(app.getHttpServer())
      .patch(`/charges/${chargeId}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('REFUNDED');
      });
  });

  it('POST /charges - 含折扣', () => {
    return request(app.getHttpServer())
      .post('/charges')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        items: [{ name: '树脂补牙', category: '修复', price: 300, quantity: 1, teethNumbers: [] }],
        discount: 50,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.totalAmount).toBe('250');
        expect(res.body.discount).toBe('50');
      });
  });

  it('GET /charges?status=UNPAID - 按状态过滤', () => {
    return request(app.getHttpServer())
      .get('/charges?status=UNPAID')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.items.length).toBe(1);
      });
  });
});
```

- [ ] **Step 9: 运行 e2e 测试验证**

```bash
cd apps/api; pnpm test:e2e -- charges.e2e-spec.ts
```
预期：10 个测试全部通过。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/charges apps/api/src/app.module.ts apps/api/test/charges.e2e-spec.ts; git commit -m "feat(api): add charges module with payment and refund"
```

---

## Task 3: 后端 prescriptions 模块（处方）

**Files:**
- Create: `apps/api/src/modules/prescriptions/prescriptions.module.ts`
- Create: `apps/api/src/modules/prescriptions/prescriptions.controller.ts`
- Create: `apps/api/src/modules/prescriptions/prescriptions.service.ts`
- Create: `apps/api/src/modules/prescriptions/dto/create-prescription.dto.ts`
- Create: `apps/api/src/modules/prescriptions/dto/query-prescription.dto.ts`
- Create: `apps/api/test/prescriptions.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 CreatePrescriptionDto**

创建 `apps/api/src/modules/prescriptions/dto/create-prescription.dto.ts`：
```typescript
import { IsString, IsOptional, IsArray, ValidateNested, IsInt, Min, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class PrescriptionItemDto {
  @IsString()
  @IsOptional()
  drugCode?: string;

  @IsString()
  drugName!: string;

  @IsString()
  spec!: string;

  @IsString()
  dosage!: string;

  @IsString()
  frequency!: string;

  @IsInt()
  @Min(1)
  days!: number;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsString()
  unit!: string;
}

export class CreatePrescriptionDto {
  @IsString()
  patientId!: string;

  @IsString()
  @IsOptional()
  visitId?: string;

  @IsString()
  doctorId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];

  @IsString()
  @IsOptional()
  remark?: string;
}
```

- [ ] **Step 2: 创建 QueryPrescriptionDto**

创建 `apps/api/src/modules/prescriptions/dto/query-prescription.dto.ts`：
```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryPrescriptionDto {
  @IsString()
  @IsOptional()
  patientId?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize = 20;
}
```

- [ ] **Step 3: 创建 prescriptions.service.ts**

创建 `apps/api/src/modules/prescriptions/prescriptions.service.ts`：
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { QueryPrescriptionDto } from './dto/query-prescription.dto';

@Injectable()
export class PrescriptionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePrescriptionDto) {
    const rx = await this.prisma.prescription.create({
      data: {
        patientId: dto.patientId,
        visitId: dto.visitId,
        doctorId: dto.doctorId,
        remark: dto.remark,
        items: {
          create: dto.items.map((item) => ({
            drugCode: item.drugCode ?? null,
            drugName: item.drugName,
            spec: item.spec,
            dosage: item.dosage,
            frequency: item.frequency,
            days: item.days,
            quantity: item.quantity,
            unit: item.unit,
          })),
        },
      },
      include: {
        items: true,
        patient: { select: { id: true, name: true, code: true, gender: true, age: true } },
        doctor: { select: { id: true, name: true } },
      },
    });
    return rx;
  }

  async findAll(dto: QueryPrescriptionDto) {
    const where: any = {};
    if (dto.patientId) where.patientId = dto.patientId;

    const [items, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          patient: { select: { id: true, name: true, code: true } },
          doctor: { select: { id: true, name: true } },
        },
      }),
      this.prisma.prescription.count({ where }),
    ]);

    return { items, total, page: dto.page, pageSize: dto.pageSize };
  }

  async findOne(id: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        items: true,
        patient: { select: { id: true, name: true, code: true, gender: true, phone: true } },
        doctor: { select: { id: true, name: true } },
      },
    });
    if (!rx) throw new NotFoundException('处方不存在');
    return rx;
  }

  async remove(id: string) {
    const rx = await this.findOne(id);
    await this.prisma.prescription.delete({ where: { id } });
    return rx;
  }
}
```

- [ ] **Step 4: 创建 prescriptions.controller.ts**

创建 `apps/api/src/modules/prescriptions/prescriptions.controller.ts`：
```typescript
import { Controller, Post, Get, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { QueryPrescriptionDto } from './dto/query-prescription.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('prescriptions')
@UseGuards(JwtAuthGuard)
export class PrescriptionsController {
  constructor(private prescriptions: PrescriptionsService) {}

  @Post()
  create(@Body() dto: CreatePrescriptionDto) {
    return this.prescriptions.create(dto);
  }

  @Get()
  findAll(@Query() dto: QueryPrescriptionDto) {
    return this.prescriptions.findAll(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prescriptions.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prescriptions.remove(id);
  }
}
```

- [ ] **Step 5: 创建 prescriptions.module.ts + 注册到 app.module**

```typescript
import { Module } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionsController } from './prescriptions.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PrescriptionsService],
  controllers: [PrescriptionsController],
})
export class PrescriptionsModule {}
```

在 `app.module.ts` 的 imports 中追加 `PrescriptionsModule`。

- [ ] **Step 6: 写 e2e 测试**

创建 `apps/api/test/prescriptions.e2e-spec.ts`，参照 charges 模式，写 6-8 个测试用例（创建处方、分页查询、详情、删除、空明细校验、按患者过滤）。

测试数据准备与 charges 一致（beforeAll 清理顺序与 charges.e2e-spec.ts 相同，注意要删 chargeItem/charge 再删 visit/appointment 等）。

- [ ] **Step 7: 运行 e2e 测试验证**

```bash
cd apps/api; pnpm test:e2e -- prescriptions.e2e-spec.ts
```
预期全部通过。

- [ ] **Step 8: 提交**

```bash
git add apps/api/src/modules/prescriptions apps/api/src/app.module.ts apps/api/test/prescriptions.e2e-spec.ts; git commit -m "feat(api): add prescriptions module with drug items"
```

---

## Task 4: 后端 treatment-plans 模块（治疗计划 + 聚合/明细视图）

**Files:**
- Create: `apps/api/src/modules/treatment-plans/treatment-plans.module.ts`
- Create: `apps/api/src/modules/treatment-plans/treatment-plans.controller.ts`
- Create: `apps/api/src/modules/treatment-plans/treatment-plans.service.ts`
- Create: `apps/api/src/modules/treatment-plans/dto/create-plan.dto.ts`
- Create: `apps/api/src/modules/treatment-plans/dto/update-plan-item.dto.ts`
- Create: `apps/api/src/modules/treatment-plans/dto/query-plan.dto.ts`
- Create: `apps/api/test/treatment-plans.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 CreateTreatmentPlanDto**

创建 `apps/api/src/modules/treatment-plans/dto/create-plan.dto.ts`：
```typescript
import { IsString, IsOptional, IsArray, ValidateNested, IsInt, Min, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class PlanItemDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  category!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsArray()
  teethNumbers: number[] = [];

  @IsString()
  @IsOptional()
  remark?: string;
}

export class CreateTreatmentPlanDto {
  @IsString()
  patientId!: string;

  @IsString()
  @IsOptional()
  visitId?: string;

  @IsString()
  doctorId!: string;

  @IsString()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanItemDto)
  items!: PlanItemDto[];

  @IsString()
  @IsOptional()
  remark?: string;
}
```

- [ ] **Step 2: 创建 UpdatePlanItemDto**

创建 `apps/api/src/modules/treatment-plans/dto/update-plan-item.dto.ts`：
```typescript
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PlanItemStatus } from '@prisma/client';

export class UpdatePlanItemDto {
  @IsEnum(PlanItemStatus)
  @IsOptional()
  status?: PlanItemStatus;

  @IsString()
  @IsOptional()
  treatmentId?: string;

  @IsString()
  @IsOptional()
  remark?: string;
}
```

- [ ] **Step 3: 创建 QueryPlanDto**

创建 `apps/api/src/modules/treatment-plans/dto/query-plan.dto.ts`：
```typescript
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PlanStatus } from '@prisma/client';

export class QueryPlanDto {
  @IsString()
  @IsOptional()
  patientId?: string;

  @IsEnum(PlanStatus)
  @IsOptional()
  status?: PlanStatus;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize = 20;
}
```

- [ ] **Step 4: 创建 treatment-plans.service.ts**

创建 `apps/api/src/modules/treatment-plans/treatment-plans.service.ts`：
```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTreatmentPlanDto } from './dto/create-plan.dto';
import { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import { QueryPlanDto } from './dto/query-plan.dto';
import { PlanStatus, PlanItemStatus } from '@prisma/client';

@Injectable()
export class TreatmentPlansService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTreatmentPlanDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('治疗计划至少包含一个项目');
    }
    const totalFee = dto.items.reduce((sum, it) => sum + it.price * it.quantity, 0);

    const plan = await this.prisma.treatmentPlan.create({
      data: {
        patientId: dto.patientId,
        visitId: dto.visitId,
        doctorId: dto.doctorId,
        name: dto.name,
        status: PlanStatus.DRAFT,
        totalFee,
        remark: dto.remark,
        items: {
          create: dto.items.map((it) => ({
            code: it.code,
            name: it.name,
            category: it.category,
            price: it.price,
            quantity: it.quantity,
            teethNumbers: it.teethNumbers ?? [],
            status: PlanItemStatus.PLANNED,
            remark: it.remark,
          })),
        },
      },
      include: { items: true },
    });
    return plan;
  }

  async findAll(dto: QueryPlanDto) {
    const where: any = {};
    if (dto.patientId) where.patientId = dto.patientId;
    if (dto.status) where.status = dto.status;

    const [items, total] = await Promise.all([
      this.prisma.treatmentPlan.findMany({
        where,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          patient: { select: { id: true, name: true, code: true } },
          doctor: { select: { id: true, name: true } },
        },
      }),
      this.prisma.treatmentPlan.count({ where }),
    ]);
    return { items, total, page: dto.page, pageSize: dto.pageSize };
  }

  async findOne(id: string) {
    const plan = await this.prisma.treatmentPlan.findUnique({
      where: { id },
      include: {
        items: { orderBy: { id: 'asc' } },
        patient: { select: { id: true, name: true, code: true } },
        doctor: { select: { id: true, name: true } },
      },
    });
    if (!plan) throw new NotFoundException('治疗计划不存在');
    return plan;
  }

  async approve(id: string) {
    const plan = await this.findOne(id);
    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('只有草稿状态可以确认');
    }
    return this.prisma.treatmentPlan.update({
      where: { id },
      data: { status: PlanStatus.APPROVED },
      include: { items: true },
    });
  }

  async updateItem(planId: string, itemId: string, dto: UpdatePlanItemDto) {
    const plan = await this.findOne(planId);
    const item = plan.items.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('计划项目不存在');

    const updated = await this.prisma.treatmentPlanItem.update({
      where: { id: itemId },
      data: {
        status: dto.status,
        treatmentId: dto.treatmentId,
        remark: dto.remark,
        completedAt: dto.status === PlanItemStatus.COMPLETED ? new Date() : item.completedAt,
      },
    });

    // 检查所有项目状态，自动更新计划整体状态
    const allItems = await this.prisma.treatmentPlanItem.findMany({
      where: { planId },
    });
    const allCompleted = allItems.every((i) => i.status === PlanItemStatus.COMPLETED || i.status === PlanItemStatus.SKIPPED);
    const anyInProgress = allItems.some((i) => i.status === PlanItemStatus.IN_PROGRESS);

    let newStatus = plan.status;
    if (allCompleted && plan.status !== PlanStatus.DRAFT) {
      newStatus = PlanStatus.COMPLETED;
    } else if (anyInProgress && plan.status === PlanStatus.APPROVED) {
      newStatus = PlanStatus.IN_PROGRESS;
    }

    if (newStatus !== plan.status) {
      await this.prisma.treatmentPlan.update({
        where: { id: planId },
        data: { status: newStatus },
      });
    }

    return updated;
  }

  async cancel(id: string) {
    const plan = await this.findOne(id);
    if (plan.status === PlanStatus.COMPLETED) {
      throw new BadRequestException('已完成的计划不能取消');
    }
    return this.prisma.treatmentPlan.update({
      where: { id },
      data: { status: PlanStatus.CANCELLED },
      include: { items: true },
    });
  }
}
```

- [ ] **Step 5: 创建 treatment-plans.controller.ts**

创建 `apps/api/src/modules/treatment-plans/treatment-plans.controller.ts`：
```typescript
import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { TreatmentPlansService } from './treatment-plans.service';
import { CreateTreatmentPlanDto } from './dto/create-plan.dto';
import { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import { QueryPlanDto } from './dto/query-plan.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('treatment-plans')
@UseGuards(JwtAuthGuard)
export class TreatmentPlansController {
  constructor(private plans: TreatmentPlansService) {}

  @Post()
  create(@Body() dto: CreateTreatmentPlanDto) {
    return this.plans.create(dto);
  }

  @Get()
  findAll(@Query() dto: QueryPlanDto) {
    return this.plans.findAll(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.plans.findOne(id);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.plans.approve(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.plans.cancel(id);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePlanItemDto,
  ) {
    return this.plans.updateItem(planId, itemId, dto);
  }
}
```

- [ ] **Step 6: 创建 treatment-plans.module.ts + 注册到 app.module**

```typescript
import { Module } from '@nestjs/common';
import { TreatmentPlansService } from './treatment-plans.service';
import { TreatmentPlansController } from './treatment-plans.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TreatmentPlansService],
  controllers: [TreatmentPlansController],
})
export class TreatmentPlansModule {}
```

在 `app.module.ts` 的 imports 中追加 `TreatmentPlansModule`。

- [ ] **Step 7: 写 e2e 测试**

创建 `apps/api/test/treatment-plans.e2e-spec.ts`，写 10 个测试用例：
1. 创建治疗计划（含 3 个项目）
2. 空项目返回 400
3. 分页查询
4. 获取详情（含 items）
5. 确认计划（DRAFT → APPROVED）
6. 非草稿状态确认返回 400
7. 更新项目状态（PLANNED → IN_PROGRESS → COMPLETED，自动推进计划状态）
8. 所有项目完成后计划自动变 COMPLETED
9. 取消计划
10. 按状态过滤

- [ ] **Step 8: 运行 e2e 测试验证**

```bash
cd apps/api; pnpm test:e2e -- treatment-plans.e2e-spec.ts
```
预期全部通过。

- [ ] **Step 9: 运行全部 e2e 测试确认无回归**

```bash
cd apps/api; pnpm test:e2e
```
预期所有套件全部通过。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/treatment-plans apps/api/src/app.module.ts apps/api/test/treatment-plans.e2e-spec.ts; git commit -m "feat(api): add treatment-plans module with status flow and auto-progress"
```

---

## Task 5: 前端收费收银页

**Files:**
- Create: `apps/web/src/lib/charges.ts`
- Create: `apps/web/src/modules/charge/ChargePage.tsx`
- Create: `apps/web/src/modules/charge/NewChargeDialog.tsx`
- Modify: `apps/web/src/routes/index.tsx`

功能要点：
- 收费列表页：搜索患者、按状态筛选、显示金额/状态/票据号
- 新建收费单：选择患者、添加收费项目（从治疗项目字典选 or 手输）、自动算合计、折扣
- 支付弹窗：选择支付方式、输入金额、支持部分支付
- 退款功能

实现方式参照 Task 6/7/8 的前端写法，用同样的 UI 组件体系（Button/Input/Select/Dialog/Badge/Table）。

写完整代码，包含 API hooks（useCharges/useCreateCharge/usePayCharge/useRefundCharge）。

- [ ] **Step 1-4: 按 TDD 模式完成 charge 页面代码**
- [ ] **Step 5: tsc --noEmit + build 验证**
- [ ] **Step 6: 提交**

---

## Task 6: 前端处方列表 + 处方打印

**Files:**
- Create: `apps/web/src/lib/prescriptions.ts`
- Create: `apps/web/src/modules/prescription/PrescriptionListPage.tsx`
- Create: `apps/web/src/modules/prescription/NewPrescriptionDialog.tsx`
- Create: `apps/web/src/modules/prescription/PrescriptionPrint.tsx`
- Modify: `apps/web/src/routes/index.tsx`

功能要点：
- 处方列表：按患者筛选、显示药品数、医生、时间
- 新建处方：从药品字典选药（支持搜索）、填写用法用量（剂量/频次/天数）、自动算数量
- 处方打印页：标准处方笺格式（诊所名、患者信息、Rp 格式药品列表、医生签名栏），打印时调 `window.print()`

---

## Task 7: 前端治疗计划（聚合视图 + 明细视图）

**Files:**
- Create: `apps/web/src/lib/treatment-plans.ts`
- Create: `apps/web/src/modules/treatment-plan/TreatmentPlanListPage.tsx`
- Create: `apps/web/src/modules/treatment-plan/TreatmentPlanDetailPage.tsx`
- Create: `apps/web/src/modules/treatment-plan/NewPlanDialog.tsx`
- Modify: `apps/web/src/routes/index.tsx`

功能要点：
- 计划列表：按患者/状态筛选，卡片式展示（名称、总费用、进度、状态）
- 计划详情页双视图切换：
  - 聚合视图：按分类（修复/牙髓/外科等）分组显示项目数量和小计费用，类似套餐总览
  - 明细视图：每行一个项目，可切换状态（计划/进行中/已完成/跳过），关联到对应治疗记录
- 新建计划：从治疗项目字典多选、指定牙位、自动算总价
- 确认/取消计划操作

---

## Task 8: 患者详情页 Phase 3 扩展（Tab 接入 + 数据联动）

**Files:**
- Modify: `apps/web/src/modules/patient/PatientDetailPage.tsx`

在现有 3 个 Tab 基础上追加 3 个：
- 收费记录 Tab：展示该患者的所有收费单，可查看明细、补打收据
- 处方记录 Tab：展示处方列表，可点击打印
- 治疗计划 Tab：展示治疗计划卡片列表（聚合视图），点击进入详情

保持左侧牙位图过滤器对治疗记录的联动不变。

---

# 自检清单

## 1. Spec 覆盖

| Phase 3 条目 | 对应 Task |
|-------------|-----------|
| 收费模块（Charge + ChargeItem） | Task 1 + Task 2 ✅ |
| 处方模块（Prescription + Item） | Task 1 + Task 3 ✅ |
| 治疗计划模块（Plan + PlanItem） | Task 1 + Task 4 ✅ |
| 药品字典 seed | Task 1 ✅ |
| 收费前端页面 + 支付 + 退款 | Task 5 |
| 处方前端 + 打印 | Task 6 |
| 治疗计划前端 + 聚合/明细双视图 | Task 7 |
| 患者详情页扩展（收费/处方/计划 Tab） | Task 8 |
| 后端 e2e 测试全覆盖 | Task 2 + 3 + 4 ✅ |

## 2. Placeholder 扫描

无 TODO/TBD/占位符。

## 3. 类型一致性

前端 interface 字段名与后端 Prisma model 一致：
- Charge: `id/patientId/visitId/doctorId/number/totalAmount/paidAmount/discount/status/payMethod/paidAt/items/createdAt`
- ChargeItem: `name/category/price/quantity/teethNumbers/subtotal`
- Prescription: `id/patientId/visitId/doctorId/items/remark/createdAt`
- TreatmentPlan: `id/patientId/visitId/doctorId/name/status/totalFee/items/createdAt`
- PlanItem: `code/name/category/price/quantity/teethNumbers/status/treatmentId/completedAt/remark`

枚举值前后端完全一致。

## 4. 决策点

1. **Charge.items 从 Json 改为关联表**：原 schema 用 items Json，改为 ChargeItem 关联表，便于报表聚合和明细查询。这是对原 MVP 计划的修正，请确认。

2. **Task 5/6/7/8 代码量较大**：Task 5-8（前端 4 个页面）代码量多，但模式与 Task 6/7/8 类似，给 subagent 执行时应给出完整代码，还是只给结构让 subagent 自己写？建议还是给完整代码，保证一致性。

3. **Prescription.age 字段**：原 plan 中 Patient 没有 age 字段（通过 birthDate 计算），处方打印需要年龄的话前端自己算。DTO 中不要出现 age。
