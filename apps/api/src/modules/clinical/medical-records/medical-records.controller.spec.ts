import { Test, TestingModule } from '@nestjs/testing';
import { MedicalRecordsController } from './medical-records.controller';
import { MedicalRecordsService } from './medical-records.service';

describe('MedicalRecordsController', () => {
  let controller: MedicalRecordsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      queryRecords: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      lock: jest.fn(),
      listTemplates: jest.fn(),
      createTemplate: jest.fn(),
      updateTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
      listPhrases: jest.fn(),
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase: jest.fn(),
      createModifyRequest: jest.fn(),
      listModifyRequests: jest.fn(),
      reviewModifyRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicalRecordsController],
      providers: [{ provide: MedicalRecordsService, useValue: service }],
    }).compile();

    controller = module.get(MedicalRecordsController);
  });

  describe('findAll', () => {
    it('传入 query 和 page/pageSize 字符串调用 service.queryRecords', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.queryRecords.mockResolvedValue(expected);

      const result = await controller.findAll(
        { patientId: 'p-1', visitId: 'v-1' },
        '1',
        '50',
      );
      expect(result).toEqual(expected);
      expect(service.queryRecords).toHaveBeenCalledWith({
        patientId: 'p-1',
        visitId: 'v-1',
        page: 1,
        pageSize: 50,
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.queryRecords.mockResolvedValue({ items: [], total: 0 });

      await controller.findAll({});
      expect(service.queryRecords).toHaveBeenCalledWith({
        patientId: undefined,
        visitId: undefined,
        page: 1,
        pageSize: 50,
      });
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'm-1', patientId: 'p-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('m-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('m-1');
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', visitId: 'v-1', content: '主诉' };
      const expected = { id: 'm-1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { content: '更新内容' };
      const expected = { id: 'm-1', content: '更新内容' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('m-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith('m-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      const expected = { success: true };
      service.remove.mockResolvedValue(expected);

      const result = await controller.remove('m-1');
      expect(result).toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith('m-1');
    });
  });

  describe('lock', () => {
    it('调用 service.lock 传入 id 和 user.id', async () => {
      const req = { user: { id: 'u-1', name: '医生' } } as any;
      const expected = { id: 'm-1', locked: true };
      service.lock.mockResolvedValue(expected);

      const result = await controller.lock('m-1', req);
      expect(result).toEqual(expected);
      expect(service.lock).toHaveBeenCalledWith('m-1', 'u-1');
    });

    it('req.user 为 undefined 时传入 undefined', async () => {
      const req = {} as any;
      service.lock.mockResolvedValue({ id: 'm-1' });

      await controller.lock('m-1', req);
      expect(service.lock).toHaveBeenCalledWith('m-1', undefined);
    });
  });

  describe('模板管理', () => {
    it('listTemplates 调用 service.listTemplates 传入 userId 和 category', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const expected = [{ id: 't-1', name: '模板1' }];
      service.listTemplates.mockResolvedValue(expected);

      const result = await controller.listTemplates('复诊', req);
      expect(result).toEqual(expected);
      expect(service.listTemplates).toHaveBeenCalledWith('u-1', '复诊');
    });

    it('createTemplate 调用 service.createTemplate 传入 dto 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const dto = { name: '新模板', content: '内容', category: '初诊' };
      service.createTemplate.mockResolvedValue({ id: 't-1', ...dto });

      const result = await controller.createTemplate(dto, req);
      expect(result.id).toBe('t-1');
      expect(service.createTemplate).toHaveBeenCalledWith(dto, 'u-1');
    });

    it('updateTemplate 调用 service.updateTemplate 传入 id、dto 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const dto = { name: '更新模板' };
      service.updateTemplate.mockResolvedValue({ id: 't-1', name: '更新模板' });

      const result = await controller.updateTemplate('t-1', dto, req) as any;
      expect(result.name).toBe('更新模板');
      expect(service.updateTemplate).toHaveBeenCalledWith('t-1', dto, 'u-1');
    });

    it('deleteTemplate 调用 service.deleteTemplate 传入 id 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      service.deleteTemplate.mockResolvedValue({ success: true });

      const result = await controller.deleteTemplate('t-1', req);
      expect(result).toEqual({ success: true });
      expect(service.deleteTemplate).toHaveBeenCalledWith('t-1', 'u-1');
    });
  });

  describe('短语管理', () => {
    it('listPhrases 调用 service.listPhrases 传入 userId 和 category', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const expected = [{ id: 'p-1', content: '短语1' }];
      service.listPhrases.mockResolvedValue(expected);

      const result = await controller.listPhrases('诊断', req);
      expect(result).toEqual(expected);
      expect(service.listPhrases).toHaveBeenCalledWith('u-1', '诊断');
    });

    it('createPhrase 调用 service.createPhrase 传入 dto 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const dto = { content: '新短语', category: '诊断' };
      service.createPhrase.mockResolvedValue({ id: 'p-1', ...dto });

      const result = await controller.createPhrase(dto as any, req);
      expect(result.id).toBe('p-1');
      expect(service.createPhrase).toHaveBeenCalledWith(dto, 'u-1');
    });

    it('updatePhrase 调用 service.updatePhrase 传入 id、dto 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const dto = { content: '更新短语' };
      service.updatePhrase.mockResolvedValue({ id: 'p-1', content: '更新短语' });

      const result = await controller.updatePhrase('p-1', dto, req) as any;
      expect(result.content).toBe('更新短语');
      expect(service.updatePhrase).toHaveBeenCalledWith('p-1', dto, 'u-1');
    });

    it('deletePhrase 调用 service.deletePhrase 传入 id 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      service.deletePhrase.mockResolvedValue({ success: true });

      const result = await controller.deletePhrase('p-1', req);
      expect(result).toEqual({ success: true });
      expect(service.deletePhrase).toHaveBeenCalledWith('p-1', 'u-1');
    });
  });

  describe('修改请求管理', () => {
    it('createModifyRequest 调用 service.createModifyRequest 传入 dto 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const dto = { recordId: 'm-1', reason: '需要更新诊断' };
      service.createModifyRequest.mockResolvedValue({ id: 'mr-1', ...dto });

      const result = await controller.createModifyRequest(dto, req);
      expect(result.id).toBe('mr-1');
      expect(service.createModifyRequest).toHaveBeenCalledWith(dto, 'u-1');
    });

    it('listModifyRequests 调用 service.listModifyRequests 传入 status', async () => {
      const expected = [{ id: 'mr-1', status: 'PENDING' }];
      service.listModifyRequests.mockResolvedValue(expected);

      const result = await controller.listModifyRequests('PENDING');
      expect(result).toEqual(expected);
      expect(service.listModifyRequests).toHaveBeenCalledWith('PENDING');
    });

    it('reviewModifyRequest 调用 service.reviewModifyRequest 传入 id、dto 和 userId', async () => {
      const req = { user: { id: 'u-1' } } as any;
      const dto = { approved: true, reviewNote: '同意' };
      service.reviewModifyRequest.mockResolvedValue({ id: 'mr-1', status: 'APPROVED' });

      const result = await controller.reviewModifyRequest('mr-1', dto as any, req) as any;
      expect(result.status).toBe('APPROVED');
      expect(service.reviewModifyRequest).toHaveBeenCalledWith('mr-1', dto, 'u-1');
    });
  });
});
