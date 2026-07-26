import {
  ok,
  err,
  isOk,
  isErr,
  map,
  flatMap,
  unwrapOr,
  match,
  fromThrowable,
  fromPromise,
  businessError,
  type Result,
  type Ok,
  type Err,
  type BusinessError,
} from './result';

describe('Result', () => {
  describe('工厂函数', () => {
    it('ok 应创建成功的 Result', () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('err 应创建失败的 Result', () => {
      const error = new Error('test error');
      const result = err(error);
      expect(result.ok).toBe(false);
      expect(result.error).toBe(error);
    });

    it('ok 可以包含任意类型值', () => {
      const strResult = ok('hello');
      expect(strResult.value).toBe('hello');

      const objResult = ok({ a: 1, b: 2 });
      expect(objResult.value).toEqual({ a: 1, b: 2 });

      const arrResult = ok([1, 2, 3]);
      expect(arrResult.value).toEqual([1, 2, 3]);
    });

    it('err 可以包含任意错误类型', () => {
      const strError = err('string error');
      expect(strError.error).toBe('string error');

      const objError = err({ code: 'E001', message: 'custom error' });
      expect(objError.error).toEqual({ code: 'E001', message: 'custom error' });
    });
  });

  describe('类型守卫', () => {
    it('isOk 对 Ok 返回 true', () => {
      const result = ok(42);
      expect(isOk(result)).toBe(true);
    });

    it('isOk 对 Err 返回 false', () => {
      const result = err(new Error('test'));
      expect(isOk(result)).toBe(false);
    });

    it('isErr 对 Err 返回 true', () => {
      const result = err(new Error('test'));
      expect(isErr(result)).toBe(true);
    });

    it('isErr 对 Ok 返回 false', () => {
      const result = ok(42);
      expect(isErr(result)).toBe(false);
    });

    it('isOk 类型守卫应正确缩小类型', () => {
      const result: Result<number, Error> = ok(42);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      } else {
        throw new Error('不应进入 else 分支');
      }
    });

    it('isErr 类型守卫应正确缩小类型', () => {
      const error = new Error('test');
      const result: Result<number, Error> = err(error);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      } else {
        throw new Error('不应进入 else 分支');
      }
    });
  });

  describe('map', () => {
    it('map 对 Ok 值应用函数', () => {
      const result = ok(42);
      const mapped = map(result, (x) => x * 2);
      expect(mapped.ok).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe(84);
      }
    });

    it('map 对 Err 保持错误不变', () => {
      const error = new Error('test');
      const result = err(error);
      const mapped = map(result, (x: number) => x * 2);
      expect(mapped.ok).toBe(false);
      if (isErr(mapped)) {
        expect(mapped.error).toBe(error);
      }
    });

    it('map 可以转换值的类型', () => {
      const result = ok(42);
      const mapped = map(result, (x) => x.toString());
      expect(mapped.ok).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe('42');
      }
    });
  });

  describe('flatMap', () => {
    it('flatMap 对 Ok 值应用返回 Result 的函数', () => {
      const result = ok(42);
      const flatMapped = flatMap(result, (x) => ok(x * 2));
      expect(flatMapped.ok).toBe(true);
      if (isOk(flatMapped)) {
        expect(flatMapped.value).toBe(84);
      }
    });

    it('flatMap 可以从 Ok 转为 Err', () => {
      const result = ok(42);
      const error = new Error('converted to error');
      const flatMapped = flatMap(result, () => err(error));
      expect(flatMapped.ok).toBe(false);
      if (isErr(flatMapped)) {
        expect(flatMapped.error).toBe(error);
      }
    });

    it('flatMap 对 Err 保持错误不变', () => {
      const error = new Error('original error');
      const result = err(error);
      const flatMapped = flatMap(result, (x: number) => ok(x * 2));
      expect(flatMapped.ok).toBe(false);
      if (isErr(flatMapped)) {
        expect(flatMapped.error).toBe(error);
      }
    });

    it('flatMap 链式调用', () => {
      const result = ok(10);
      const final = flatMap(
        flatMap(result, (x) => ok(x + 5)),
        (x) => ok(x * 2),
      );
      expect(final.ok).toBe(true);
      if (isOk(final)) {
        expect(final.value).toBe(30);
      }
    });
  });

  describe('unwrapOr', () => {
    it('unwrapOr 对 Ok 返回值', () => {
      const result = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('unwrapOr 对 Err 返回默认值', () => {
      const result = err(new Error('test'));
      expect(unwrapOr(result, 0)).toBe(0);
    });

    it('unwrapOr 默认值可以是任意类型', () => {
      const result: Result<string, Error> = err(new Error('test'));
      expect(unwrapOr(result, 'default')).toBe('default');
    });
  });

  describe('match', () => {
    it('match 对 Ok 调用 ok 处理函数', () => {
      const result: Result<number, Error> = ok(42);
      const matched = match<number, Error, string>(result, {
        ok: (value) => `success: ${value}`,
        err: (error) => `error: ${error.message}`,
      });
      expect(matched).toBe('success: 42');
    });

    it('match 对 Err 调用 err 处理函数', () => {
      const error = new Error('test error');
      const result: Result<number, Error> = err(error);
      const matched = match<number, Error, string>(result, {
        ok: (value) => `success: ${value}`,
        err: (e) => `error: ${e.message}`,
      });
      expect(matched).toBe('error: test error');
    });

    it('match 可以返回不同类型', () => {
      const okResult: Result<number, Error> = ok(42);
      const okNum = match(okResult, {
        ok: (v) => v,
        err: () => -1,
      });
      expect(okNum).toBe(42);

      const errResult: Result<number, Error> = err(new Error('test'));
      const errNum = match(errResult, {
        ok: (v) => v,
        err: () => -1,
      });
      expect(errNum).toBe(-1);
    });
  });

  describe('fromThrowable', () => {
    it('fromThrowable 对无异常函数返回 Ok', () => {
      const result = fromThrowable(() => 42);
      expect(result.ok).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });

    it('fromThrowable 捕获 Error 类型异常', () => {
      const error = new Error('test error');
      const result = fromThrowable(() => {
        throw error;
      });
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      }
    });

    it('fromThrowable 捕获非 Error 类型异常并包装为 Error', () => {
      const result = fromThrowable(() => {
        throw 'string error';
      });
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string error');
      }
    });

    it('fromThrowable 捕获数字类型异常', () => {
      const result = fromThrowable(() => {
        throw 404;
      });
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('404');
      }
    });

    it('fromThrowable 捕获对象类型异常', () => {
      const obj = { code: 'E001', message: 'custom' };
      const result = fromThrowable(() => {
        throw obj;
      });
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('[object Object]');
      }
    });
  });

  describe('fromPromise', () => {
    it('fromPromise 对成功的 Promise 返回 Ok', async () => {
      const promise = Promise.resolve(42);
      const result = await fromPromise(promise);
      expect(result.ok).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });

    it('fromPromise 对失败的 Promise 返回 Err', async () => {
      const error = new Error('test error');
      const promise = Promise.reject(error);
      const result = await fromPromise(promise);
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      }
    });

    it('fromPromise 捕获非 Error 类型的拒绝并包装为 Error', async () => {
      const promise = Promise.reject('string error');
      const result = await fromPromise(promise);
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string error');
      }
    });

    it('fromPromise 处理异步函数', async () => {
      async function asyncFn() {
        return 'async result';
      }
      const result = await fromPromise(asyncFn());
      expect(result.ok).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe('async result');
      }
    });
  });

  describe('BusinessError', () => {
    it('businessError 应创建业务错误', () => {
      const result = businessError('USER_NOT_FOUND', '用户不存在');
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error.code).toBe('USER_NOT_FOUND');
        expect(result.error.message).toBe('用户不存在');
        expect(result.error.details).toBeUndefined();
      }
    });

    it('businessError 可以包含 details', () => {
      const details = { userId: 123 };
      const result = businessError('USER_NOT_FOUND', '用户不存在', details);
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error.details).toEqual({ userId: 123 });
      }
    });

    it('BusinessError 接口应包含正确的字段', () => {
      const error: BusinessError = {
        code: 'E001',
        message: 'test',
        details: { foo: 'bar' },
      };
      expect(error.code).toBe('E001');
      expect(error.message).toBe('test');
      expect(error.details).toEqual({ foo: 'bar' });
    });
  });

  describe('组合使用', () => {
    it('map 和 flatMap 链式调用', () => {
      const result = ok(10);
      const final = flatMap(map(result, (x) => x + 5), (x) =>
        x > 10 ? ok(x * 2) : err(new Error('too small')),
      );
      expect(final.ok).toBe(true);
      if (isOk(final)) {
        expect(final.value).toBe(30);
      }
    });

    it('使用 match 处理结果', () => {
      function divide(a: number, b: number): Result<number, string> {
        if (b === 0) {
          return err('不能除以零');
        }
        return ok(a / b);
      }

      const result1 = divide(10, 2);
      const message1 = match(result1, {
        ok: (v) => `结果是 ${v}`,
        err: (e) => `错误: ${e}`,
      });
      expect(message1).toBe('结果是 5');

      const result2 = divide(10, 0);
      const message2 = match(result2, {
        ok: (v) => `结果是 ${v}`,
        err: (e) => `错误: ${e}`,
      });
      expect(message2).toBe('错误: 不能除以零');
    });

    it('fromThrowable 与 map 结合使用', () => {
      const result = fromThrowable(() => JSON.parse('{"a": 1}'));
      const mapped = map(result, (obj) => obj.a);
      expect(mapped.ok).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe(1);
      }
    });

    it('fromThrowable 解析失败的 JSON', () => {
      const result = fromThrowable(() => JSON.parse('invalid json'));
      expect(result.ok).toBe(false);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(SyntaxError);
      }
    });
  });

  describe('类型推断', () => {
    it('Result 类型应正确推断 Ok 和 Err', () => {
      const okResult: Result<number, string> = ok(42);
      expect(okResult.ok).toBe(true);

      const errResult: Result<number, string> = err('error');
      expect(errResult.ok).toBe(false);
    });

    it('Ok 类型应独立使用', () => {
      const result: Ok<number> = ok(42);
      expect(result.value).toBe(42);
    });

    it('Err 类型应独立使用', () => {
      const result: Err<string> = err('error');
      expect(result.error).toBe('error');
    });
  });
});
