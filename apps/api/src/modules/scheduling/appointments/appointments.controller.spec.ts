import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException } from '@common/errors';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ConflictException } from '@nestjs/common';
import { DbService } from '../../../db/db.service';

describe('AppointmentsController', () => {
  let controller: AppointmentsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      queryAppointments: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const mockDbService = {
      prepare: jest.fn().mockReturnValue({
        get: jest.fn(),
        run: jest.fn(),
        all: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        { provide: AppointmentsService, useValue: service },
        { provide: DbService, useValue: mockDbService },
      ],
    }).compile();

    controller = module.get(AppointmentsController);
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', startTime: '2026-01-01T00:00:00Z' };
      const created = { id: 'appt-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto as any);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('冲突时透传 ConflictException', async () => {
      service.create.mockRejectedValue(new ConflictException('时间冲突'));
      await expect(controller.create({ patientId: 'p-1' } as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('findMany', () => {
    it('调用 service.queryAppointments 传入查询参数', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.queryAppointments.mockResolvedValue(expected);
      const q = { patientId: 'p-1', status: 'CONFIRMED' } as any;

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.queryAppointments).toHaveBeenCalledWith(q);
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'appt-1', status: 'CONFIRMED' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('appt-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('appt-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('Appointment不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { status: 'CANCELLED' };
      const updated = { id: 'appt-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('appt-1', dto as any);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('appt-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue('appt-1');
      const result = await controller.remove('appt-1');
      expect(result).toBe('appt-1');
      expect(service.remove).toHaveBeenCalledWith('appt-1');
    });
  });
});
