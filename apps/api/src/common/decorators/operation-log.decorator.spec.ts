import 'reflect-metadata';
import { OperationLog, OPERATION_LOG_KEY, OperationLogOptions } from './operation-log.decorator';

describe('OperationLog Decorator', () => {
  it('应将 OperationLogOptions 设置为元数据', () => {
    const options: OperationLogOptions = {
      action: 'CREATE',
      target: 'Patient',
    };

    class TestController {
      @OperationLog(options)
      create() {}
    }

    const metadata = Reflect.getMetadata(OPERATION_LOG_KEY, TestController.prototype.create);
    expect(metadata).toEqual(options);
  });

  it('OPERATION_LOG_KEY 应为 operation_log', () => {
    expect(OPERATION_LOG_KEY).toBe('operation_log');
  });

  it('应支持 detail 和 extractUserId 回调函数', () => {
    const detail = jest.fn(() => 'detail');
    const extractUserId = jest.fn(() => 'user-1');
    const options: OperationLogOptions = {
      action: 'UPDATE',
      detail,
      extractUserId,
    };

    class TestController {
      @OperationLog(options)
      update() {}
    }

    const metadata = Reflect.getMetadata(OPERATION_LOG_KEY, TestController.prototype.update) as OperationLogOptions;
    expect(metadata.action).toBe('UPDATE');
    expect(metadata.detail).toBe(detail);
    expect(metadata.extractUserId).toBe(extractUserId);

    // 验证回调可正常调用
    expect(metadata.detail!([], {})).toBe('detail');
    expect(metadata.extractUserId!(['arg'])).toBe('user-1');
  });
});
