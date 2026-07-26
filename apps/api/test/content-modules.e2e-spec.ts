import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@db/db.service';
import { ClinicContextService } from '@common/services/clinic-context.service';
import { IdempotencyService } from '@common/services/idempotency.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '@db/test-helpers';
import { TEST_CLINIC_ID, TEST_PATIENT_ID, TEST_DOCTOR_ID } from './factories';
import { ImagingService } from '@modules/content/imaging/imaging.service';
import { ToothRecordsService } from '@modules/content/tooth-records/tooth-records.service';
import { WechatService } from '@modules/communication/wechat/wechat.service';

describe('Content Modules E2E - Imaging / ToothRecords / Wechat', () => {
  let imagingService: ImagingService;
  let toothRecordsService: ToothRecordsService;
  let wechatService: WechatService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsDoctor = <T>(fn: () => T) =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
      fn,
    );

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db);

    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        ImagingService,
        ToothRecordsService,
        WechatService,
      ],
    }).compile();

    imagingService = module.get(ImagingService);
    toothRecordsService = module.get(ToothRecordsService);
    wechatService = module.get(WechatService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  describe('Imaging', () => {
    it('创建影像记录（type 和 patientId 必填）', async () => {
      const imaging = await runAsDoctor(() =>
        imagingService.create({
          patientId: TEST_PATIENT_ID,
          type: 'PANORAMIC',
          title: '术前全景片',
          imageUrl: 'http://example.com/panoramic.jpg',
          remark: '术前评估',
          takenAt: new Date().toISOString(),
        } as any),
      );

      expect(imaging.id).toBeDefined();
      expect((imaging as any).type).toBe('PANORAMIC');
      expect((imaging as any).title).toBe('术前全景片');
      expect((imaging as any).patientId).toBe(TEST_PATIENT_ID);
      expect((imaging as any).clinicId).toBe(TEST_CLINIC_ID);
    });

    it('分页查询影像列表', async () => {
      for (let i = 0; i < 3; i++) {
        await runAsDoctor(() =>
          imagingService.create({
            patientId: TEST_PATIENT_ID,
            type: 'PANORAMIC',
            title: `全景片-${i}`,
            imageUrl: `http://example.com/img-${i}.jpg`,
          } as any),
        );
      }

      const result = await runAsDoctor(() =>
        imagingService.findMany({ page: 1, pageSize: 2 }),
      );

      expect(result.total).toBe(3);
      expect(result.items.length).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('按 title 关键词搜索影像', async () => {
      await runAsDoctor(() =>
        imagingService.create({
          patientId: TEST_PATIENT_ID,
          type: 'PANORAMIC',
          title: '术前全景片',
          imageUrl: 'http://example.com/panoramic.jpg',
        } as any),
      );
      await runAsDoctor(() =>
        imagingService.create({
          patientId: TEST_PATIENT_ID,
          type: 'INTRAORAL',
          title: '口内照片',
          imageUrl: 'http://example.com/intraoral.jpg',
        } as any),
      );

      const result = await runAsDoctor(() =>
        imagingService.findMany({ keyword: '全景' }),
      );

      expect(result.total).toBe(1);
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).title).toBe('术前全景片');
    });

    it('按 id 查询单个影像', async () => {
      const created = await runAsDoctor(() =>
        imagingService.create({
          patientId: TEST_PATIENT_ID,
          type: 'CBCT',
          title: '锥形束CT',
          imageUrl: 'http://example.com/cbct.jpg',
        } as any),
      );

      const found = await runAsDoctor(() => imagingService.findOne(created.id));

      expect(found.id).toBe(created.id);
      expect((found as any).type).toBe('CBCT');
      expect((found as any).title).toBe('锥形束CT');
    });
  });

  describe('ToothRecords', () => {
    it('Upsert - 新建牙位记录（11号牙）', async () => {
      const record = await runAsDoctor(() =>
        toothRecordsService.upsert(TEST_PATIENT_ID, 11, {
          currentStatus: 'DECAYED',
          conditions: ['DECAY'],
          remark: '远中邻面龋',
        }),
      );

      expect(record.id).toBeDefined();
      expect((record as any).toothNumber).toBe(11);
      expect((record as any).patientId).toBe(TEST_PATIENT_ID);
      expect((record as any).currentStatus).toBe('DECAYED');
      expect((record as any).conditions).toEqual(['DECAY']);
    });

    it('Upsert - 更新已存在的牙位记录（同牙位不同状态）', async () => {
      // 先创建
      await runAsDoctor(() =>
        toothRecordsService.upsert(TEST_PATIENT_ID, 11, {
          currentStatus: 'DECAYED',
          conditions: ['DECAY'],
          remark: '初诊',
        }),
      );

      // 再更新同一牙位
      const updated = await runAsDoctor(() =>
        toothRecordsService.upsert(TEST_PATIENT_ID, 11, {
          currentStatus: 'FILLED',
          conditions: ['FILLING'],
          remark: '已充填',
        }),
      );

      expect((updated as any).toothNumber).toBe(11);
      expect((updated as any).currentStatus).toBe('FILLED');
      expect((updated as any).conditions).toEqual(['FILLING']);
      expect((updated as any).remark).toBe('已充填');
    });

    it('FindByTooth - 查询指定牙位记录', async () => {
      await runAsDoctor(() =>
        toothRecordsService.upsert(TEST_PATIENT_ID, 11, {
          currentStatus: 'DECAYED',
          conditions: ['DECAY'],
          remark: '龋齿',
        }),
      );

      const record = await runAsDoctor(() =>
        toothRecordsService.findByTooth(TEST_PATIENT_ID, 11),
      );

      expect(record).toBeDefined();
      expect((record as any).toothNumber).toBe(11);
      expect((record as any).currentStatus).toBe('DECAYED');
      expect((record as any).conditions).toEqual(['DECAY']);
    });

    it('FindByPatient - 查询患者全部牙位记录', async () => {
      await runAsDoctor(() =>
        toothRecordsService.upsert(TEST_PATIENT_ID, 11, {
          currentStatus: 'DECAYED',
          conditions: ['DECAY'],
        }),
      );
      await runAsDoctor(() =>
        toothRecordsService.upsert(TEST_PATIENT_ID, 21, {
          currentStatus: 'SOUND',
          conditions: [],
        }),
      );

      const result = await runAsDoctor(() =>
        toothRecordsService.findByPatient(TEST_PATIENT_ID),
      );

      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
      // findByPatient 按 toothNumber 升序排列
      expect((result.items[0] as any).toothNumber).toBe(11);
      expect((result.items[1] as any).toothNumber).toBe(21);
    });

    it('RemoveByTooth - 软删除牙位记录', async () => {
      await runAsDoctor(() =>
        toothRecordsService.upsert(TEST_PATIENT_ID, 11, {
          currentStatus: 'DECAYED',
          conditions: ['DECAY'],
        }),
      );

      const res = await runAsDoctor(() =>
        toothRecordsService.removeByTooth(TEST_PATIENT_ID, 11),
      );
      expect(res).toEqual({ success: true });

      // 软删除后 findByTooth 应返回 undefined
      const record = await runAsDoctor(() =>
        toothRecordsService.findByTooth(TEST_PATIENT_ID, 11),
      );
      expect(record).toBeUndefined();
    });
  });

  describe('Wechat', () => {
    it('SendMessage - 创建消息（状态为 PENDING）', async () => {
      const result = await runAsDoctor(() =>
        wechatService.sendMessage({
          patientId: TEST_PATIENT_ID,
          type: 'APPOINTMENT_REMINDER',
          content: '您有一条预约提醒',
          templateId: 'tpl-001',
        }),
      );

      expect(result.id).toBeDefined();
      expect(result.status).toBe('PENDING');

      // 校验入库状态
      const list = await runAsDoctor(() =>
        wechatService.findMany({ patientId: TEST_PATIENT_ID }, 1, 10),
      );
      const saved = list.items.find((m: any) => m.id === result.id);
      expect(saved).toBeDefined();
      expect((saved as any).status).toBe('PENDING');
      expect((saved as any).type).toBe('APPOINTMENT_REMINDER');
      expect((saved as any).content).toBe('您有一条预约提醒');
    });

    it('FindByPatient - 仅返回指定患者的消息（过滤其他患者）', async () => {
      // 创建第二个患者用于验证过滤
      const otherPatientId = 'other-patient-002';
      db.prepare(
        "INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(otherPatientId, 'P002', '患者B', 'FEMALE', '13900000002', TEST_CLINIC_ID, 1, new Date().toISOString(), new Date().toISOString());

      // 为两个不同患者各发一条消息
      await runAsDoctor(() =>
        wechatService.sendMessage({
          patientId: TEST_PATIENT_ID,
          type: 'APPOINTMENT_REMINDER',
          content: '患者A的消息',
        }),
      );
      await runAsDoctor(() =>
        wechatService.sendMessage({
          patientId: otherPatientId,
          type: 'APPOINTMENT_REMINDER',
          content: '患者B的消息',
        }),
      );

      const result = await runAsDoctor(() =>
        wechatService.findByPatient(TEST_PATIENT_ID),
      );

      // 回归保护：findByPatient 必须正确过滤 patientId
      expect(result.total).toBe(1);
      expect(result.items.length).toBe(1);
      expect(result.items.every((m: any) => m.patientId === TEST_PATIENT_ID)).toBe(true);
    });

    it('FindMany - 分页查询消息', async () => {
      for (let i = 0; i < 3; i++) {
        await runAsDoctor(() =>
          wechatService.sendMessage({
            patientId: TEST_PATIENT_ID,
            type: 'APPOINTMENT_REMINDER',
            content: `提醒消息-${i}`,
          }),
        );
      }

      const result = await runAsDoctor(() =>
        wechatService.findMany({ patientId: TEST_PATIENT_ID }, 1, 2),
      );

      expect(result.total).toBe(3);
      expect(result.items.length).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      // 所有返回项均属于该患者
      expect(
        result.items.every((m: any) => m.patientId === TEST_PATIENT_ID),
      ).toBe(true);
    });
  });
});
