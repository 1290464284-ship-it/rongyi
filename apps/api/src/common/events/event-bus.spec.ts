import { EventEmitter2EventBus } from './event-bus';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChargeCreatedEvent, PatientCreatedEvent } from './domain-events';

describe('EventEmitter2EventBus 事件总线', () => {
  let bus: EventEmitter2EventBus;
  let emitter: { emit: jest.Mock; emitAsync: jest.Mock };

  beforeEach(() => {
    emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    bus = new EventEmitter2EventBus(emitter as unknown as EventEmitter2);
  });

  describe('emit', () => {
    it('应以 eventName 为 key 调用 eventEmitter.emit', () => {
      const event = new ChargeCreatedEvent('c-1', 'p-1', 1000, 'clinic-1');
      bus.emit(event);
      expect(emitter.emit).toHaveBeenCalledWith('charge.created', event);
    });

    it('患者事件也应正确分发', () => {
      const event = new PatientCreatedEvent('p-1', 'clinic-1');
      bus.emit(event);
      expect(emitter.emit).toHaveBeenCalledWith('patient.created', event);
    });
  });

  describe('emitAsync', () => {
    it('应以 eventName 为 key 调用 eventEmitter.emitAsync', async () => {
      const event = new ChargeCreatedEvent('c-1', 'p-1', 500, 'clinic-1');
      emitter.emitAsync.mockResolvedValue(['result1', 'result2']);
      const result = await bus.emitAsync(event);
      expect(emitter.emitAsync).toHaveBeenCalledWith('charge.created', event);
      expect(result).toEqual(['result1', 'result2']);
    });

    it('无监听器时应返回空数组', async () => {
      const event = new PatientCreatedEvent('p-1');
      emitter.emitAsync.mockResolvedValue([]);
      const result = await bus.emitAsync(event);
      expect(result).toEqual([]);
    });
  });
});
