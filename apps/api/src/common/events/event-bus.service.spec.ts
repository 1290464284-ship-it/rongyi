import { EventBusService } from './event-bus.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from './domain-events';

function mockEvent(name: string): DomainEvent {
  return { eventName: name, data: {}, timestamp: new Date(), clinicId: 'c1', userId: 'u1' } as unknown as DomainEvent;
}

describe('EventBusService', () => {
  let bus: EventBusService;
  let emitter: jest.Mocked<EventEmitter2>;

  beforeEach(() => {
    emitter = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>;
    bus = new EventBusService(emitter);
  });

  afterEach(() => {
    bus.onModuleDestroy();
  });

  describe('emit', () => {
    it('应向 RxJS Subject 和 EventEmitter2 发送事件', () => {
      const event = mockEvent('test.event');
      bus.emit(event);
      expect(emitter.emit).toHaveBeenCalledWith('test.event', event);
    });

    it('RxJS 订阅者应收到事件', () => {
      const handler = jest.fn();
      bus.on('test.event').subscribe(handler);

      const event = mockEvent('test.event');
      bus.emit(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('RxJS 订阅者抛错不影响 EventEmitter2', () => {
      bus.on('test.event').subscribe(() => {
        throw new Error('subscriber error');
      });

      const event = mockEvent('test.event');
      // 不应抛出
      expect(() => bus.emit(event)).not.toThrow();
      expect(emitter.emit).toHaveBeenCalled();
    });

    it('EventEmitter2 抛错不影响主流程', () => {
      emitter.emit.mockImplementation(() => {
        throw new Error('emitter error');
      });

      const event = mockEvent('test.event');
      expect(() => bus.emit(event)).not.toThrow();
    });
  });

  describe('on', () => {
    it('应只收到匹配事件名的事件', () => {
      const handler = jest.fn();
      bus.on('specific.event').subscribe(handler);

      bus.emit(mockEvent('other.event'));
      expect(handler).not.toHaveBeenCalled();

      bus.emit(mockEvent('specific.event'));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('onAll', () => {
    it('应收到所有事件', () => {
      const handler = jest.fn();
      bus.onAll().subscribe(handler);

      bus.emit(mockEvent('a'));
      bus.emit(mockEvent('b'));
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('onModuleDestroy', () => {
    it('应完成 Subject，后续订阅不再收到事件', () => {
      const handler = jest.fn();
      bus.on('test.event').subscribe(handler);

      bus.onModuleDestroy();

      // Subject 已 complete，新事件不会被送达
      bus.emit(mockEvent('test.event'));
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
