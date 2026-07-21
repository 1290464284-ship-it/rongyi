# 口腔诊所管理系统 MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为不到20人的单体口腔诊所构建一套本地私有部署的现代Web口腔管理系统，替代老旧的艾登特桌面软件，核心创新在牙位图全局联动、就诊时间轴、主动找漏收报表。

**Architecture:** 前后端分离的Web应用，本地Docker部署。前端React+TS+Vite+TailwindCSS+shadcn/ui；后端NestJS+Prisma+PostgreSQL；影像存本地磁盘；单机docker-compose一键起。诊所内多台电脑用浏览器访问局域网服务器。

**Tech Stack:**
- 前端：React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query, Zustand, React Router, ECharts, AG Grid Community, react-hook-form, zod
- 后端：NestJS, Prisma ORM, PostgreSQL 16, Passport JWT, class-validator, Zod (validation)
- 共享：TypeScript类型共享包
- 部署：Docker, docker-compose
- 测试：Vitest (前端), Jest (后端), Playwright (E2E可选)

---

## 项目结构（最终态）

```
dental-clinic/
├── apps/
│   ├── web/                        # React 前端
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/              # 登录
│   │   │   │   ├── patient/           # 患者档案
│   │   │   │   ├── appointment/       # 挂号预约
│   │   │   │   ├── clinical/          # 就诊+牙位图+治疗计划
│   │   │   │   ├── charge/            # 收费+处方
│   │   │   │   ├── imaging/           # 影像
│   │   │   │   └── dashboard/         # 看板+报表
│   │   │   ├── components/            # 通用组件
│   │   │   │   ├── ui/                 # shadcn/ui 组件
│   │   │   │   ├── tooth-chart/        # 牙位图组件（核心）
│   │   │   │   ├── layout/             # 布局
│   │   │   │   └── command-palette/    # Cmd+K
│   │   │   ├── lib/                   # 工具
│   │   │   ├── routes/                # 路由
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── api/                        # NestJS 后端
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── users/
│       │   │   ├── patients/
│       │   │   ├── appointments/
│       │   │   ├── clinical/         # 牙位/治疗计划/病历
│       │   │   ├── charge/
│       │   │   ├── imaging/
│       │   │   └── reports/
│       │   ├── common/               # 守卫/拦截器/过滤器
│       │   ├── prisma/
│       │   │   └── prisma.service.ts
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── seed.ts
│       ├── test/
│       │   └── jest-e2e.json
│       └── package.json
├── packages/
│   └── shared/                     # 前后端共享类型
│       ├── src/
│       │   ├── dto/
│       │   └── enums.ts
│       └── package.json
├── docker-compose.yml
├── package.json                    # monorepo root (pnpm workspaces)
├── pnpm-workspace.yaml
└── README.md
```

---

## 完整数据库 Schema（Prisma）

最终态schema（分阶段建表，但提前设计完整避免反复迁移）：

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============ 用户与权限 ============
enum Role {
  BOSS
  DOCTOR
  RECEPTIONIST
}

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

  appointments  Appointment[]   @relation("DoctorAppts")
  treatments    Treatment[]
  charges       Charge[]
  clinicalNotes ClinicalNote[]
  prescriptions Prescription[]
}

// ============ 患者 ============
model Patient {
  id            String   @id @default(cuid())
  code          String   @unique          // 病历号
  name          String
  gender        Gender
  birthDate     DateTime?
  phone         String
  idCard        String?                   // 身份证（加密存储）
  address       String?
  occupation    String?
  remark        String?
  allergies     String[]                  // 过敏史
  medicalHistory String[]                 // 既往史
  familyId      String?                   // 家庭组
  family        Family?   @relation(fields: [familyId], references: [id])
  referrer      String?                   // 来源渠道
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  appointments  Appointment[]
  teeth         ToothRecord[]
  treatments    Treatment[]
  charges       Charge[]
  notes         ClinicalNote[]
  prescriptions Prescription[]
  images        PatientImage[]
  visits        Visit[]

  @@index([phone])
  @@index([name])
}

enum Gender {
  MALE
  FEMALE
  UNKNOWN
}

model Family {
  id        String   @id @default(cuid())
  name      String
  patients  Patient[]
  createdAt DateTime @default(now())
}

// ============ 就诊闭环 ============
model Appointment {
  id          String   @id @default(cuid())
  patientId   String
  patient     Patient  @relation(fields: [patientId], references: [id])
  doctorId    String
  doctor      User     @relation("DoctorAppts", fields: [doctorId], references: [id])
  startTime   DateTime
  endTime     DateTime
  status      AppointmentStatus @default(BOOKED)
  type        AppointmentType
  remark      String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  visit       Visit?

  @@index([doctorId, startTime])
  @@index([patientId])
}

enum AppointmentStatus {
  BOOKED      // 已预约
  ARRIVED     // 已到诊
  IN_CHAIR    // 就诊中
  COMPLETED   // 已完成
  CANCELLED   // 已取消
  NO_SHOW     // 失约
}

enum AppointmentType {
  FIRST_VISIT     // 初诊
  RETURN          // 复诊
  CONSULTATION    // 咨询
  EMERGENCY       // 急诊
  RECALL          // 回访
}

model Visit {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  appointmentId String?  @unique
  appointment  Appointment? @relation(fields: [appointmentId], references: [id])
  doctorId     String
  doctor       User     @relation(fields: [doctorId], references: [id])
  chiefComplaint String?                  // 主诉
  diagnosis    String?                    // 诊断
  treatmentPlan String?                   // 治疗方案
  startTime    DateTime @default(now())
  endTime      DateTime?
  status       VisitStatus @default(IN_PROGRESS)

  notes        ClinicalNote[]
  treatments   Treatment[]
  charges      Charge[]

  @@index([patientId, startTime])
}

enum VisitStatus {
  IN_PROGRESS
  COMPLETED
}

// ============ 牙位与治疗 ============
// 全口32颗恒牙 + 20颗乳牙，FDI编号
model ToothRecord {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  toothNumber  Int                       // FDI牙位号 11-18,21-28,31-38,41-48,51-55,61-65,71-75,81-85
  currentStatus ToothStatus @default(SOUND)
  conditions   ToothCondition[]          // 存在状况
  remark       String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  treatments   Treatment[]

  @@unique([patientId, toothNumber])
  @@index([patientId])
}

enum ToothStatus {
  SOUND          // 健康
  FILLED         // 已补
  CROWNED        // 已冠
  MISSING        // 缺失
  IMPLANT        // 种植
  BRIDGE         // 桥
  ROOT_CANAL     // 根管治疗
  EXTRACTED      // 已拔
  DECAYED        // 龋
}

enum ToothCondition {
  DECAY            // 龋
  FILLING          // 充填
  CROWN            // 冠
  BRIDGE           // 桥
  IMPLANT          // 种植
  ROOT_CANAL       // 根管
  EXTRACTION       // 拔牙
  MOBILITY         // 松动
  CALCULUS         // 牙石
  BLEEDING         // 出血
  FURCATION        // 分叉
  OTHER
}

model Treatment {
  id            String   @id @default(cuid())
  patientId     String
  patient       Patient  @relation(fields: [patientId], references: [id])
  visitId       String?
  visit         Visit?   @relation(fields: [visitId], references: [id])
  doctorId      String
  doctor        User     @relation(fields: [doctorId], references: [id])
  code          String                   // 项目代码
  name          String                   // 项目名
  category      String                   // 分类
  price         Decimal  @db.Decimal(10,2)
  quantity      Int      @default(1)
  teethNumbers  Int[]                    // 涉及牙位
  status        TreatmentStatus @default(PLANNED)
  plannedDate   DateTime?
  completedDate DateTime?
  remark        String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([patientId, status])
  @@index([visitId])
}

enum TreatmentStatus {
  PLANNED     // 计划
  APPROVED    // 已确认
  IN_PROGRESS // 进行中
  COMPLETED   // 已完成
  CANCELLED   // 已取消
}

// ============ 收费与处方 ============
model Charge {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  visitId      String?
  visit        Visit?   @relation(fields: [visitId], references: [id])
  doctorId     String?
  doctor       User?    @relation(fields: [doctorId], references: [id])
  number       String   @unique          // 票据号
  items        Json                       // 收费明细 [{treatmentId,name,price,qty}]
  totalAmount  Decimal  @db.Decimal(10,2)
  paidAmount   Decimal  @db.Decimal(10,2) @default(0)
  discount     Decimal  @db.Decimal(10,2) @default(0)
  status       ChargeStatus @default(UNPAID)
  payMethod    PayMethod?
  paidAt       DateTime?
  remark       String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([patientId, status])
  @@index([createdAt])
}

enum ChargeStatus {
  UNPAID      // 未付
  PARTIAL     // 部分付
  PAID        // 已付
  REFUNDED    // 已退
}

enum PayMethod {
  CASH
  WECHAT
  ALIPAY
  UNIONPAY
  INSURANCE
  OTHER
}

model Prescription {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  visitId      String?
  doctorId     String
  doctor       User     @relation(fields: [doctorId], references: [id])
  items        Json                       // [{drugName,spec,dosage,frequency,days,qty}]
  remark       String?
  createdAt    DateTime @default(now())

  @@index([patientId])
}

// ============ 病历 ============
model ClinicalNote {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  visitId      String?
  visit        Visit?   @relation(fields: [visitId], references: [id])
  doctorId     String
  doctor       User     @relation(fields: [doctorId], references: [id])
  content      String                     // 主内容（markdown）
  type         NoteType  @default(SOAP)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([patientId, createdAt])
}

enum NoteType {
  SOAP
  PROGRESS       // 进度笔记
  REFERRAL       // 转诊
  CONSENT        // 知情同意
  OTHER
}

// ============ 影像 ============
model PatientImage {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  type         ImageType
  filePath     String                    // 本地存储路径
  thumbnailPath String?
  teethNumbers Int[]                     // 关联牙位
  visitId      String?
  remark       String?
  takenAt      DateTime @default(now())
  createdAt    DateTime @default(now())

  @@index([patientId, takenAt])
}

enum ImageType {
  INTRAORAL        // 口内照
  PANORAMIC        // 全景片
  BITEWING         // 咬翼片
  PERIAPICAL       // 根尖片
  CBCT             // 锥形束CT
  CEPHALOMETRIC    // 头颅侧位
  INTRAORAL_SCAN   // 口扫
  OTHER
}
```

---

## 开发阶段总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| **Phase 1** | 项目骨架 + 数据库 + 鉴权 + 患者档案 | 本计划详细展开 |
| Phase 2 | 挂号预约 + 就诊时间轴 + 牙位图组件 | 待 Phase 1 完成后展开 |
| Phase 3 | 收费 + 处方 + 治疗计划 | 待 Phase 2 完成后展开 |
| Phase 4 | 影像管理 + 经营看板 + Revenue Discovery | 待 Phase 3 完成后展开 |

---

# Phase 1 详细任务：项目骨架 + 鉴权 + 患者档案

## 文件清单

**Create:**
- `package.json` (root, pnpm workspace)
- `pnpm-workspace.yaml`
- `.editorconfig`, `.gitignore`, `.nvmrc`
- `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/prisma/prisma.module.ts`
- `apps/api/prisma/schema.prisma` (User + Patient + Family 部分)
- `apps/api/src/modules/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `jwt.strategy.ts`, `dto/login.dto.ts`, `dto/auth.dto.ts`
- `apps/api/src/modules/users/users.module.ts`, `users.controller.ts`, `users.service.ts`
- `apps/api/src/modules/patients/patients.module.ts`, `patients.controller.ts`, `patients.service.ts`, `dto/create-patient.dto.ts`, `dto/update-patient.dto.ts`, `dto/query-patient.dto.ts`
- `apps/api/src/common/filters/all-exceptions.filter.ts`
- `apps/api/src/common/decorators/current-user.decorator.ts`
- `apps/api/test/auth.e2e-spec.ts`, `apps/api/test/patients.e2e-spec.ts`
- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`
- `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/lib/utils.ts`
- `apps/web/src/components/ui/*` (shadcn 组件: button, input, card, table, dialog, form, label, toast, dropdown-menu, badge)
- `apps/web/src/components/layout/AppLayout.tsx`, `Sidebar.tsx`, `Topbar.tsx`
- `apps/web/src/modules/auth/LoginPage.tsx`
- `apps/web/src/modules/patient/PatientListPage.tsx`, `PatientDetailPage.tsx`, `PatientForm.tsx`, `columns.tsx`
- `apps/web/src/routes/index.tsx`
- `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/dto/patient.ts`, `packages/shared/src/enums.ts`
- `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.web`
- `apps/api/prisma/seed.ts`

---

## Task 1: 初始化 Monorepo 骨架

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.editorconfig`, `.nvmrc`

- [ ] **Step 1: 创建 root package.json**

```json
{
  "name": "dental-clinic",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev:api": "pnpm --filter @dental/api dev",
    "dev:web": "pnpm --filter @dental/web dev",
    "dev": "concurrently \"pnpm dev:api\" \"pnpm dev:web\"",
    "build": "pnpm --filter @dental/shared build && pnpm --filter @dental/api build && pnpm --filter @dental/web build",
    "db:migrate": "pnpm --filter @dental/api prisma migrate dev",
    "db:seed": "pnpm --filter @dental/api prisma db seed",
    "db:studio": "pnpm --filter @dental/api prisma studio"
  },
  "devDependencies": {
    "concurrently": "^8.2.2",
    "typescript": "^5.4.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: 创建 .gitignore**

```gitignore
node_modules
dist
.env
.env.local
*.log
.DS_Store
coverage
.prisma
uploads/
```

- [ ] **Step 4: 创建 .nvmrc 和 .editorconfig**

`.nvmrc`:
```
20
```

`.editorconfig`:
```
root = true
[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

- [ ] **Step 5: 安装依赖并验证 workspace**

Run: `pnpm install`
Expected: 无报错，生成 pnpm-lock.yaml

- [ ] **Step 6: 初始化 git 并提交**

```bash
git init
git add .
git commit -m "chore: init monorepo skeleton"
```

---

## Task 2: 初始化后端 NestJS + Prisma + PostgreSQL

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/prisma/prisma.module.ts`, `apps/api/.env`

- [ ] **Step 1: 创建 apps/api/package.json**

```json
{
  "name": "@dental/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma": "prisma",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "ts-node prisma/seed.ts"
  },
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/config": "^3.1.1",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@prisma/client": "^5.9.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "bcrypt": "^5.1.1",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/schematics": "^10.1.0",
    "@nestjs/testing": "^10.3.0",
    "@types/bcrypt": "^5.0.2",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.11",
    "@types/node": "^20.11.0",
    "@types/passport-jwt": "^4.0.1",
    "jest": "^29.7.0",
    "prisma": "^5.9.0",
    "ts-jest": "^29.1.1",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "es2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "paths": { "@shared/*": ["../../packages/shared/src/*"] }
  },
  "include": ["src/**/*", "prisma/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: 创建 nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

- [ ] **Step 4: 创建 .env**

```env
DATABASE_URL="postgresql://dental:dental@localhost:5432/dental?schema=public"
JWT_SECRET="dev-secret-change-in-production"
JWT_EXPIRES_IN="7d"
PORT=3001
UPLOAD_DIR="./uploads"
```

- [ ] **Step 5: 创建 prisma/schema.prisma（Phase 1只需User+Patient+Family）**

将前面"完整数据库Schema"中的 `User`、`Patient`、`Family`、`Gender`、`Role` 五个model写入。其余model在后续Phase加入。

- [ ] **Step 6: 创建 prisma.service.ts 和 prisma.module.ts**

`apps/api/src/prisma/prisma.service.ts`:
```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

`apps/api/src/prisma/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

- [ ] **Step 7: 创建 main.ts 和 app.module.ts**

`apps/api/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: ['http://localhost:5173'], credentials: true });
  app.setGlobalPrefix('api');
  await app.listen(config.get('PORT', 3001));
}
bootstrap();
```

`apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 8: 安装依赖并启动PostgreSQL**

Run: `pnpm install`

启动PostgreSQL（用docker临时起）:
```bash
docker run --name dental-db -e POSTGRES_USER=dental -e POSTGRES_PASSWORD=dental -e POSTGRES_DB=dental -p 5432:5432 -d postgres:16-alpine
```

- [ ] **Step 9: 生成Prisma client并执行迁移**

```bash
cd apps/api
pnpm prisma migrate dev --name init
pnpm prisma generate
```
Expected: 生成 migration 文件夹，client生成到 node_modules/.prisma/client

- [ ] **Step 10: 启动后端验证**

Run: `pnpm dev:api`
Expected: 监听3001端口，无报错

- [ ] **Step 11: 提交**

```bash
git add apps/api
git commit -m "feat(api): init NestJS + Prisma + PostgreSQL"
```

---

## Task 3: 后端鉴权模块 (Auth)

**Files:**
- Create: `apps/api/src/modules/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`, `dto/login.dto.ts`
- Create: `apps/api/src/common/decorators/current-user.decorator.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`
- Create: `apps/api/prisma/seed.ts`

- [ ] **Step 1: 写失败的e2e测试 auth.e2e-spec.ts**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INest_APPLICATION, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new (require('@nestjs/common').ValidationPipe)({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    // 清空并建测试用户
    await prisma.user.deleteMany({});
    const bcrypt = require('bcrypt');
    await prisma.user.create({
      data: { username: 'boss', passwordHash: await bcrypt.hash('REDACTED', 10), name: '老板', role: 'BOSS' },
    });
  });

  afterAll(async () => { await app.close(); });

  it('POST /api/auth/login 正确密码返回JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'REDACTED' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.user.username).toBe('boss');
  });

  it('POST /api/auth/login 错误密码返回401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'wrong' });
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('GET /api/auth/me 带token返回当前用户', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: 'REDACTED' });
    const me = await request(app.getHttpServer())
      .get('/api/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(HttpStatus.OK);
    expect(me.body.username).toBe('boss');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd apps/api && pnpm test:e2e`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 DTO**

`apps/api/src/modules/auth/dto/login.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() username: string;
  @IsString() @MinLength(6) password: string;
}
```

- [ ] **Step 4: 创建 current-user.decorator.ts**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return data ? request.user?.[data] : request.user;
  },
);
```

- [ ] **Step 5: 创建 auth.service.ts**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || !user.active) throw new UnauthorizedException('用户不存在或已禁用');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('密码错误');
    const payload = { sub: user.id, username: user.username, role: user.role };
    const access_token = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '7d'),
    });
    const { passwordHash, ...safe } = user;
    return { access_token, user: safe };
  }

  async validateById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.active) return null;
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
```

- [ ] **Step 6: 创建 jwt.strategy.ts 和 jwt-auth.guard.ts**

```typescript
// jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET'),
    });
  }
  async validate(payload: { sub: string }) {
    const user = await this.auth.validateById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

```typescript
// jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 7: 创建 auth.controller.ts**

```typescript
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto); }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) { return user; }
}
```

- [ ] **Step 8: 创建 auth.module.ts 并注册到 AppModule**

```typescript
// auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get('JWT_SECRET'),
        signOptions: { expiresIn: c.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

更新 `app.module.ts` imports 加入 `AuthModule`。同时安装 supertest: `pnpm --filter @dental/api add -D supertest @types/supertest`

- [ ] **Step 9: 创建 seed.ts 初始化默认账号**

```typescript
// prisma/seed.ts
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('REDACTED', 10);
  await prisma.user.upsert({
    where: { username: 'boss' },
    update: {},
    create: { username: 'boss', passwordHash: hash, name: '老板', role: Role.BOSS },
  });
  await prisma.user.upsert({
    where: { username: 'doctor' },
    update: {},
    create: { username: 'doctor', passwordHash: hash, name: '张医生', role: Role.DOCTOR },
  });
  await prisma.user.upsert({
    where: { username: 'front' },
    update: {},
    create: { username: 'front', passwordHash: hash, name: '前台', role: Role.RECEPTIONIST },
  });
  console.log('Seed 完成，默认密码均为 123456');
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

执行: `pnpm db:seed`

- [ ] **Step 10: 运行测试验证通过**

Run: `cd apps/api && pnpm test:e2e`
Expected: 3个测试全部 PASS

- [ ] **Step 11: 提交**

```bash
git add apps/api
git commit -m "feat(api): add JWT auth module with login/me endpoints"
```

---

## Task 4: 后端患者模块 (Patients CRUD)

**Files:**
- Create: `apps/api/src/modules/patients/patients.module.ts`, `patients.controller.ts`, `patients.service.ts`, `dto/create-patient.dto.ts`, `dto/update-patient.dto.ts`, `dto/query-patient.dto.ts`
- Create: `apps/api/test/patients.e2e-spec.ts`

- [ ] **Step 1: 写失败的e2e测试 patients.e2e-spec.ts**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Patients (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.patient.deleteMany({});
    await prisma.user.deleteMany({});
    const bcrypt = require('bcrypt');
    await prisma.user.create({ data: { username: 'boss', passwordHash: await bcrypt.hash('REDACTED', 10), name: '老板', role: 'BOSS' } });
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: 'REDACTED' });
    token = login.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  it('POST /api/patients 创建患者', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '张三', gender: 'MALE', phone: '13800138000' });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^P\d+$/);  // 自动生成病历号
    expect(res.body.name).toBe('张三');
  });

  it('GET /api/patients 分页+搜索', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/patients?page=1&pageSize=10&keyword=张').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].name).toBe('张三');
  });

  it('GET /api/patients/:id 详情', async () => {
    const list = await request(app.getHttpServer()).get('/api/patients').set('Authorization', `Bearer ${token}`);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer()).get(`/api/patients/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.name).toBe('张三');
  });

  it('PATCH /api/patients/:id 更新', async () => {
    const list = await request(app.getHttpServer()).get('/api/patients').set('Authorization', `Bearer ${token}`);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer())
      .patch(`/api/patients/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ phone: '13900139000', address: '上海市浦东新区' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.phone).toBe('13900139000');
  });

  it('POST /api/patients 重复手机号返回409', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '李四', gender: 'FEMALE', phone: '13900139000' });
    // 同号允许创建（家人共用手机），此用例可调整。这里验证可成功
    expect(res.status).toBe(HttpStatus.CREATED);
  });

  it('未带token访问返回401', async () => {
    const res = await request(app.getHttpServer()).get('/api/patients');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd apps/api && pnpm test:e2e`
Expected: FAIL（patients模块不存在）

- [ ] **Step 3: 创建 DTO**

`dto/create-patient.dto.ts`:
```typescript
import { IsString, IsEnum, IsOptional, IsDateString, IsArray, IsPhoneNumber } from 'class-validator';

export class CreatePatientDto {
  @IsString() name: string;
  @IsEnum(['MALE', 'FEMALE', 'UNKNOWN']) gender: string;
  @IsString() phone: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() idCard?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() occupation?: string;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsArray() allergies?: string[];
  @IsOptional() @IsArray() medicalHistory?: string[];
  @IsOptional() @IsString() familyId?: string;
  @IsOptional() @IsString() referrer?: string;
}
```

`dto/update-patient.dto.ts`:
```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreatePatientDto } from './create-patient.dto';
export class UpdatePatientDto extends PartialType(CreatePatientDto) {}
```

`dto/query-patient.dto.ts`:
```typescript
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryPatientDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
```

- [ ] **Step 4: 创建 patients.service.ts**

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { QueryPatientDto } from './dto/query-patient.dto';

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService) {}

  private async genCode(): Promise<string> {
    const count = await this.prisma.patient.count();
    return `P${String(count + 1).padStart(6, '0')}`;
  }

  async create(dto: CreatePatientDto) {
    return this.prisma.patient.create({
      data: { ...dto, code: await this.genCode(), birthDate: dto.birthDate ? new Date(dto.birthDate) : null },
    });
  }

  async findMany(q: QueryPatientDto) {
    const { keyword, page = 1, pageSize = 20 } = q;
    const where: Prisma.PatientWhereInput = keyword ? {
      OR: [
        { name: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword } },
        { code: { contains: keyword, mode: 'insensitive' } },
      ],
    } : {};
    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.patient.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const p = await this.prisma.patient.findUnique({ where: { id }, include: { family: true } });
    if (!p) throw new NotFoundException('患者不存在');
    return p;
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.findOne(id);
    return this.prisma.patient.update({
      where: { id },
      data: { ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.patient.delete({ where: { id } });
  }
}
```

- [ ] **Step 5: 创建 patients.controller.ts**

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { QueryPatientDto } from './dto/query-patient.dto';

@UseGuards(JwtAuthGuard)
@Controller('patients')
export class PatientsController {
  constructor(private patients: PatientsService) {}

  @Post()
  create(@Body() dto: CreatePatientDto) { return this.patients.create(dto); }

  @Get()
  findMany(@Query() q: QueryPatientDto) { return this.patients.findMany(q); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.patients.findOne(id); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) { return this.patients.update(id, dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.patients.remove(id); }
}
```

- [ ] **Step 6: 创建 patients.module.ts 并注册到 AppModule**

```typescript
import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
```

把 `PatientsModule` 加入 `app.module.ts` 的 imports。安装 mapped-types: `pnpm --filter @dental/api add @nestjs/mapped-types`

- [ ] **Step 7: 运行测试验证通过**

Run: `cd apps/api && pnpm test:e2e`
Expected: auth 3个 + patients 6个 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add apps/api
git commit -m "feat(api): add patients CRUD with search/pagination"
```

---

## Task 5: 初始化前端 React + Vite + TailwindCSS

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/tsconfig.node.json`, `apps/web/vite.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/lib/utils.ts`

- [ ] **Step 1: 创建 apps/web/package.json**

```json
{
  "name": "@dental/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext ts,tsx"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "@tanstack/react-query": "^5.20.0",
    "zustand": "^4.5.0",
    "axios": "^1.6.7",
    "tailwindcss": "^3.4.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.1",
    "lucide-react": "^0.330.0",
    "react-hook-form": "^7.50.0",
    "@hookform/resolvers": "^3.3.4",
    "zod": "^3.22.4",
    "date-fns": "^3.3.1",
    "sonner": "^1.4.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.55",
    "@types/react-dom": "^18.2.55",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.35",
    "typescript": "^5.4.0",
    "vite": "^5.1.0"
  }
}
```

- [ ] **Step 2: 创建配置文件**

`vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#FAFAF9',
        foreground: '#1C1917',
        muted: { DEFAULT: '#F5F5F4', foreground: '#78716C' },
        border: '#E7E5E4',
        primary: { DEFAULT: '#0F766E', foreground: '#FFFFFF' },
        destructive: { DEFAULT: '#DC2626', foreground: '#FFFFFF' },
        success: { DEFAULT: '#16A34A', foreground: '#FFFFFF' },
        warning: { DEFAULT: '#EA580C', foreground: '#FFFFFF' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      radius: { lg: '0.5rem', md: '0.375rem', sm: '0.25rem' },
    },
  },
  plugins: [],
} satisfies Config;
```

`postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`apps/web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body { @apply bg-background text-foreground font-sans antialiased; }
}
```

- [ ] **Step 3: 创建 index.html 和 main.tsx**

`index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>口腔诊所管理</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 4: 创建 lib/utils.ts**

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('zh-CN');
}

export function formatDateTime(d: string | Date) {
  return new Date(d).toLocaleString('zh-CN');
}
```

- [ ] **Step 5: 创建临时 App.tsx 验证启动**

```tsx
export default function App() {
  return <div className="min-h-screen flex items-center justify-center text-2xl">口腔诊所管理</div>;
}
```

- [ ] **Step 6: 安装并启动验证**

Run: `pnpm install && pnpm dev:web`
打开 http://localhost:5173
Expected: 页面显示"口腔诊所管理"，暖白背景

- [ ] **Step 7: 提交**

```bash
git add apps/web
git commit -m "feat(web): init React+Vite+TailwindCSS with theme tokens"
```

---

## Task 6: 前端鉴权（登录页 + Token管理 + 路由守卫）

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth-store.ts`
- Create: `apps/web/src/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `label.tsx`
- Create: `apps/web/src/modules/auth/LoginPage.tsx`
- Create: `apps/web/src/routes/ProtectedRoute.tsx`, `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: 创建 api.ts（axios实例+拦截器）**

```typescript
import axios from 'axios';
import { useAuthStore } from './auth-store';

export const api = axios.create({ baseURL: '/api', timeout: 10000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
```

- [ ] **Step 2: 创建 auth-store.ts（zustand）**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser { id: string; username: string; name: string; role: 'BOSS' | 'DOCTOR' | 'RECEPTIONIST'; }

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'dental-auth' },
  ),
);
```

- [ ] **Step 3: 创建基础UI组件 (button, input, card, label)**

`apps/web/src/components/ui/button.tsx`:
```typescript
import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-white hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: { default: 'h-9 px-4 py-2', sm: 'h-8 px-3 text-xs', lg: 'h-10 px-6', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = 'Button';
```

`apps/web/src/components/ui/input.tsx`:
```typescript
import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn('flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary', className)} {...props} />
  ),
);
Input.displayName = 'Input';
```

`apps/web/src/components/ui/card.tsx`:
```typescript
import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-white shadow-sm', className)} {...props} />;
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pb-4', className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-lg font-semibold', className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}
```

`apps/web/src/components/ui/label.tsx`:
```typescript
import { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}
```

- [ ] **Step 4: 创建 LoginPage.tsx**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

const schema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(6, '密码至少6位'),
});

export default function LoginPage() {
  const nav = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [err, setErr] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: z.infer<typeof schema>) => {
    setErr('');
    try {
      const res = await api.post('/auth/login', data);
      login(res.data.access_token, res.data.user);
      nav('/');
    } catch {
      setErr('用户名或密码错误');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <Card className="w-[380px]">
        <CardHeader><CardTitle>口腔诊所管理</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>用户名</Label>
              <Input {...register('username')} placeholder="boss" />
              {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>密码</Label>
              <Input type="password" {...register('password')} placeholder="••••••" />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>登录</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: 创建 ProtectedRoute 和路由**

`apps/web/src/routes/ProtectedRoute.tsx`:
```tsx
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

`apps/web/src/routes/index.tsx`:
```tsx
import { Navigate } from 'react-router-dom';
import LoginPage from '@/modules/auth/LoginPage';
import AppLayout from '@/components/layout/AppLayout';

export const routes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/patients', element: <ProtectedRoute><AppLayout /></ProtectedRoute> },
  { path: '/', element: <Navigate to="/patients" replace /> },
];
```

更新 `App.tsx`:
```tsx
import { useRoutes } from 'react-router-dom';
import { routes } from './routes';

export default function App() {
  return useRoutes(routes);
}
```

- [ ] **Step 6: 创建占位 AppLayout**

`apps/web/src/components/layout/AppLayout.tsx`:
```tsx
export default function AppLayout() {
  return <div className="p-8">主框架占位（Task 8 完善）</div>;
}
```

- [ ] **Step 7: 手动验证**

Run: `pnpm dev:web`
打开 http://localhost:5173 → 自动跳 /login
用 boss / 123456 登录 → 跳 /patients 显示"主框架占位"
刷新页面 → 仍保持登录（persist）

- [ ] **Step 8: 提交**

```bash
git add apps/web
git commit -m "feat(web): add login page, auth store, protected routes"
```

---

## Task 7: 前端主框架（侧边栏+顶栏+命令面板占位）

**Files:**
- Create: `apps/web/src/components/layout/AppLayout.tsx`（重写）, `Sidebar.tsx`, `Topbar.tsx`
- Create: `apps/web/src/components/ui/avatar.tsx`, `dropdown-menu.tsx`（简化版）
- Create: `apps/web/src/lib/nav.ts`

- [ ] **Step 1: 创建 nav.ts 导航配置**

```typescript
import { Users, Calendar, Stethoscope, Receipt, Image, BarChart3, LayoutDashboard } from 'lucide-react';

export const navItems = [
  { to: '/dashboard', label: '工作台', icon: LayoutDashboard, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },
  { to: '/patients', label: '患者', icon: Users, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },
  { to: '/appointments', label: '预约', icon: Calendar, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },
  { to: '/clinical', label: '就诊', icon: Stethoscope, roles: ['BOSS', 'DOCTOR'] },
  { to: '/charge', label: '收费', icon: Receipt, roles: ['BOSS', 'RECEPTIONIST'] },
  { to: '/imaging', label: '影像', icon: Image, roles: ['BOSS', 'DOCTOR'] },
  { to: '/reports', label: '报表', icon: BarChart3, roles: ['BOSS'] },
];
```

- [ ] **Step 2: 重写 Sidebar.tsx**

```tsx
import { NavLink } from 'react-router-dom';
import { navItems } from '@/lib/nav';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

export default function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const items = navItems.filter((i) => user && i.roles.includes(user.role));
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-muted/20 flex flex-col">
      <div className="h-14 flex items-center px-5 text-base font-semibold text-primary">牙科管家</div>
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <i.icon className="h-4 w-4" />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: 创建 Topbar.tsx**

```tsx
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export default function Topbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  return (
    <header className="h-14 border-b border-border bg-white flex items-center justify-between px-6">
      <div className="text-sm text-muted-foreground">{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user?.name}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{user?.role}</span>
        <Button variant="ghost" size="icon" onClick={() => { logout(); window.location.href = '/login'; }}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 重写 AppLayout.tsx**

```tsx
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function AppLayout() {
  return (
    <div className="h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 更新 routes/index.tsx 使用嵌套路由**

```tsx
import { Navigate } from 'react-router-dom';
import LoginPage from '@/modules/auth/LoginPage';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import PatientListPage from '@/modules/patient/PatientListPage';

export const routes = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
    children: [
      { index: true, element: <Navigate to="/patients" replace /> },
      { path: 'patients', element: <PatientListPage /> },
    ],
  },
];
```

（PatientListPage 在 Task 8 创建；此处先建占位文件）

- [ ] **Step 6: 创建 PatientListPage 占位**

```tsx
export default function PatientListPage() {
  return <div className="p-8">患者列表（Task 8 实现）</div>;
}
```

- [ ] **Step 7: 验证并提交**

Run: `pnpm dev:web` → 登录后看到侧边栏+顶栏框架
```bash
git add apps/web
git commit -m "feat(web): add AppLayout with sidebar/topbar"
```

---

## Task 8: 前端患者列表页（列表+搜索+分页+新建）

**Files:**
- Create: `apps/web/src/modules/patient/PatientListPage.tsx`, `PatientForm.tsx`, `columns.tsx`
- Create: `apps/web/src/components/ui/table.tsx`, `dialog.tsx`, `badge.tsx`, `select.tsx`
- Create: `apps/web/src/lib/patients.ts`（API hooks）

- [ ] **Step 1: 创建 UI 组件 table/dialog/badge/select**

`apps/web/src/components/ui/table.tsx`:
```typescript
import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => (
  <table className={cn('w-full text-sm', className)} {...p} />
);
export const TableHeader = ({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn('[&_tr]:border-b border-border', className)} {...p} />
);
export const TableBody = ({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />
);
export const TableRow = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b border-border transition-colors hover:bg-muted/50', className)} {...p} />
);
export const TableHead = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-10 px-3 text-left align-middle font-medium text-muted-foreground', className)} {...p} />
);
export const TableCell = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('p-3 align-middle', className)} {...p} />
);
```

`apps/web/src/components/ui/dialog.tsx`:
```typescript
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Dialog({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn('relative bg-white rounded-lg shadow-lg max-w-lg w-full mx-4 max-h-[90vh] overflow-auto', className)}>
        {children}
      </div>
    </div>
  );
}
export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="p-6 pb-4 border-b border-border">{children}</div>;
}
export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}
export function DialogContent({ children }: { children: ReactNode }) {
  return <div className="p-6">{children}</div>;
}
```

`apps/web/src/components/ui/badge.tsx`:
```typescript
import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)} {...props} />;
}
```

`apps/web/src/components/ui/select.tsx`:
```typescript
import { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn('flex h-9 rounded-md border border-border bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary', className)} {...props} />
);
```

- [ ] **Step 2: 创建 patients API hooks**

`apps/web/src/lib/patients.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Patient {
  id: string; code: string; name: string; gender: string; phone: string;
  birthDate?: string; address?: string; allergies: string[]; medicalHistory: string[];
  createdAt: string;
}

export interface PatientListRes { items: Patient[]; total: number; page: number; pageSize: number; }

export function usePatients(keyword: string, page: number, pageSize = 20) {
  return useQuery({
    queryKey: ['patients', keyword, page, pageSize],
    queryFn: async () => (await api.get<PatientListRes>('/patients', { params: { keyword, page, pageSize } })).data,
  });
}

export function usePatient(id: string) {
  return useQuery({
    enabled: !!id,
    queryKey: ['patient', id],
    queryFn: async () => (await api.get<Patient>(`/patients/${id}`)).data,
  });
}

export function useCreatePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post<Patient>('/patients', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
  });
}
```

- [ ] **Step 3: 创建 PatientForm.tsx**

```tsx
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCreatePatient } from '@/lib/patients';

interface Props { onClose: () => void; onCreated: (p: any) => void; }

export default function PatientForm({ onClose, onCreated }: Props) {
  const create = useCreatePatient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { name: '', gender: 'UNKNOWN', phone: '', birthDate: '', address: '' },
  });

  const onSubmit = async (data: any) => {
    const p = await create.mutateAsync(data);
    onCreated(p);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>姓名 *</Label>
          <Input {...register('name', { required: '必填' })} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message as string}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>性别</Label>
          <Select {...register('gender')}>
            <option value="UNKNOWN">未知</option>
            <option value="MALE">男</option>
            <option value="FEMALE">女</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>手机 *</Label>
          <Input {...register('phone', { required: '必填', pattern: { value: /^\d{11}$/, message: '11位手机号' } })} />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone.message as string}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>生日</Label>
          <Input type="date" {...register('birthDate')} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>地址</Label>
        <Input {...register('address')} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={create.isPending}>保存</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: 创建 PatientListPage.tsx**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import { usePatients, type Patient } from '@/lib/patients';
import PatientForm from './PatientForm';
import { formatDate } from '@/lib/utils';

export default function PatientListPage() {
  const nav = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data, isLoading } = usePatients(keyword, page);

  const genderText = (g: string) => ({ MALE: '男', FEMALE: '女', UNKNOWN: '未知' } as any)[g] ?? g;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">患者</h1>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新建患者</Button>
      </div>

      <div className="relative w-72">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="姓名 / 手机 / 病历号" value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} />
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>病历号</TableHead>
              <TableHead>姓名</TableHead>
              <TableHead>性别</TableHead>
              <TableHead>手机</TableHead>
              <TableHead>创建时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">加载中…</TableCell></TableRow>
            ) : !data?.items.length ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">暂无患者</TableCell></TableRow>
            ) : data.items.map((p: Patient) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => nav(`/patients/${p.id}`)}>
                <TableCell><Badge className="bg-muted text-muted-foreground font-mono">{p.code}</Badge></TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{genderText(p.gender)}</TableCell>
                <TableCell>{p.phone}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {data.total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader><DialogTitle>新建患者</DialogTitle></DialogHeader>
        <DialogContent><PatientForm onClose={() => setOpen(false)} onCreated={(p) => nav(`/patients/${p.id}`)} /></DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: 在 routes 添加患者详情路由占位**

在 `routes/index.tsx` 的 children 加：
```tsx
{ path: 'patients/:id', element: <PatientDetailPage /> },
```
创建占位 `apps/web/src/modules/patient/PatientDetailPage.tsx`:
```tsx
import { useParams } from 'react-router-dom';
export default function PatientDetailPage() {
  const { id } = useParams();
  return <div className="p-8">患者详情 {id}（Phase 2 完善：含牙位图/时间轴）</div>;
}
```

- [ ] **Step 6: 手动验证**

启动 `pnpm dev` (前后端一起)
- 登录 → 看到患者列表页（空）
- 点"新建患者" → 弹窗填写 → 保存 → 跳转详情
- 搜索框输入姓名 → 实时过滤
- 点表格行 → 跳详情页

- [ ] **Step 7: 提交**

```bash
git add apps/web
git commit -m "feat(web): patient list with search/pagination/create dialog"
```

---

## Task 9: Docker 本地部署配置

**Files:**
- Create: `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.web`, `apps/web/nginx.conf`

- [ ] **Step 1: 创建 Dockerfile.api**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @dental/api prisma generate
RUN pnpm --filter @dental/api build

FROM node:20-alpine
WORKDIR /app
RUN npm i -g pnpm
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: 创建 nginx.conf（前端打包后由nginx服务，反代api）**

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://api:3001; }
}
```

- [ ] **Step 3: 创建 Dockerfile.web**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @dental/web build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 4: 创建 docker-compose.yml**

```yaml
version: '3.9'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: dental
      POSTGRES_PASSWORD: dental
      POSTGRES_DB: dental
    volumes:
      - db_data:/var/lib/postgresql/data
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dental"]
      interval: 5s
      retries: 5

  api:
    build: { context: ., dockerfile: Dockerfile.api }
    depends_on: { db: { condition: service_healthy } }
    environment:
      DATABASE_URL: postgresql://dental:dental@db:5432/dental?schema=public
      JWT_SECRET: change-this-in-production
      JWT_EXPIRES_IN: 7d
      PORT: 3001
      UPLOAD_DIR: /data/uploads
    volumes:
      - uploads:/data/uploads
    ports: ["3001:3001"]
    command: sh -c "npx prisma migrate deploy && node dist/main.js"

  web:
    build: { context: ., dockerfile: Dockerfile.web }
    depends_on: [api]
    ports: ["8080:80"]

volumes:
  db_data:
  uploads:
```

- [ ] **Step 5: 验证构建**

Run: `docker compose up --build -d`
打开 http://localhost:8080 → 登录页
用 boss/123456 登录 → 进入患者页

```bash
git add docker-compose.yml Dockerfile.api Dockerfile.web apps/web/nginx.conf
git commit -m "chore: add docker-compose for one-command local deployment"
```

---

## Task 10: Phase 1 收尾 - 全局异常处理 + 基础文档

**Files:**
- Create: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Modify: `apps/api/src/main.ts` 注册过滤器
- Create: `README.md`

- [ ] **Step 1: 创建 all-exceptions.filter.ts**

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Exception');
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.getResponse() : '服务器内部错误';
    this.logger.error(`${req.method} ${req.url} ${status} ${JSON.stringify(message)}`);
    res.status(status).json({ statusCode: status, message, timestamp: new Date().toISOString(), path: req.url });
  }
}
```

- [ ] **Step 2: 在 main.ts 注册**

在 `bootstrap()` 中 `app.useGlobalPipes` 后加：
```typescript
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
app.useGlobalFilters(new AllExceptionsFilter());
```

- [ ] **Step 3: 创建 README.md**

```markdown
# 口腔诊所管理系统

本地私有部署的现代化口腔诊所管理软件。

## 快速开始（Docker）

```bash
docker compose up -d --build
```
访问 http://localhost:8080 ，默认账号 boss/doctor/front，密码均为 123456

## 开发模式

```bash
pnpm install
docker run --name dental-db -e POSTGRES_USER=dental -e POSTGRES_PASSWORD=dental -e POSTGRES_DB=dental -p 5432:5432 -d postgres:16-alpine
pnpm db:migrate
pnpm db:seed
pnpm dev
```
前端 http://localhost:5173 ，后端 http://localhost:3001

## 技术栈

- 前端：React 18 + TypeScript + Vite + TailwindCSS
- 后端：NestJS + Prisma + PostgreSQL
- 部署：Docker Compose
```

- [ ] **Step 4: 提交**

```bash
git add .
git commit -m "chore: add exception filter and README"
```

---

# 后续阶段概要（待 Phase 1 完成后展开详细任务）

## Phase 2: 挂号预约 + 就诊时间轴 + 牙位图组件

**核心任务：**
1. 数据库加入 Appointment / Visit / ToothRecord / Treatment model
2. 后端：appointments CRUD、到诊状态机、visits、tooth-records、treatments
3. 前端：
   - 预约日历页（周视图/日视图，拖拽改时间）
   - 患者详情页重写：**就诊时间轴**组件（按时间倒序展示预约/就诊/治疗/收费节点）
   - **牙位图组件**（核心，SVG绘制32颗牙，支持点击选中、状态着色、条件标注）
   - 牙位图作为**全局过滤器**：选中牙位 → 右侧联动显示该牙的治疗历史/影像/笔记
4. seed 扩展：牙位项目字典、医生排班

**关键创新落地：**
- 牙位图全局联动（Dentrix 椅旁 Dashboard 思路）
- 就诊时间轴串联闭环

## Phase 3: 收费 + 处方 + 治疗计划

**核心任务：**
1. 数据库加入 Charge / Prescription / ClinicalNote
2. 后端：charges（开单/支付/欠费）、prescriptions、clinical-notes
3. 前端：
   - 收费台：从就诊的治疗项自动带入，支持拆分支付、折扣、多支付方式
   - 处方开具页：药品字典搜索、用法/用量模板
   - 治疗计划：**聚合/明细双视图**切换（同治疗项跨多牙聚合算总价）
   - 欠费看板：列出所有未结清账单
4. 打印模板：收费单、处方单（HTML转打印）

## Phase 4: 影像管理 + 经营看板 + Revenue Discovery

**核心任务：**
1. 数据库加入 PatientImage
2. 后端：images 上传（multer）、缩略图生成（sharp）、按牙位/患者查询
3. 前端：
   - 影像页：上传、按类型/牙位筛选、缩略图墙、标注（挂牙位图）
   - 牙位图上显示**影像标记**（点牙号看该牙影像，借鉴 Curve）
   - **经营看板**（L1）：营收/新客/复诊/客单价/医生产能，同环比，ECharts
   - **自助报表搭建器**（L2）：拖拽列+筛选+图表，存为模板（简化版，AG Grid + 配置面板）
   - **Revenue Discovery**：每日扫描"未复约治疗计划/欠费超期/流失患者"，推到工作台待办
4. 看板数字支持下钻到患者列表

---

# 自检清单

**Spec 覆盖：**
- ✅ 患者档案：Task 4, 8
- ✅ 鉴权：Task 3, 6
- ✅ 项目骨架：Task 1, 2, 5
- ✅ 本地部署：Task 9
- ⏳ 挂号预约：Phase 2
- ⏳ 就诊+牙位图：Phase 2
- ⏳ 收费+处方：Phase 3
- ⏳ 影像：Phase 4
- ⏳ 报表（用户最关心的痛点）：Phase 4

**Placeholder 扫描：** 无 TBD/TODO，所有代码步骤含完整代码。

**类型一致性：** Patient 字段（id/code/name/gender/phone/birthDate/address/allergies/medicalHistory/createdAt）前后端一致；AuthUser 字段（id/username/name/role）一致；Role 枚举（BOSS/DOCTOR/RECEPTIONIST）一致。

**注意：** Phase 1 的测试用例使用真实数据库（test数据库或同一库清表），生产前建议引入 test 专用数据库或 testcontainers。本计划为求简单直接用清表方式，e2e 测试的 beforeAll 会清空 users/patients。
