import { SqlInjectionMiddleware } from './sql-injection.middleware';
import { Request, Response, NextFunction } from 'express';
import { HttpException } from '@nestjs/common';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/test',
    method: 'GET',
    ip: '127.0.0.1',
    query: {},
    params: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  return {} as unknown as Response;
}

function createMockNext(): NextFunction {
  return jest.fn();
}

describe('SqlInjectionMiddleware', () => {
  let middleware: SqlInjectionMiddleware;

  beforeEach(() => {
    middleware = new SqlInjectionMiddleware();
  });

  describe('跳过路径', () => {
    it.each([
      ['/api/docs'],
      ['/api/docs/swagger'],
      ['/api/auth/login'],
      ['/api/auth/refresh'],
    ])('路径 %s 直接跳过检测', (path) => {
      const req = createMockReq({
        path,
        method: 'GET',
        query: { q: "select * from users" },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('GET 请求 query 参数检测', () => {
    it('正常 query 参数通过检测', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { name: '张三', page: '1' },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('检测到 select from 关键字抛出 400', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: 'select from users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
      expect(() => middleware.use(req, res, next)).toThrow('请求包含非法字符');
    });

    it('检测到 drop table 关键字', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: 'drop table users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('检测到 union select 关键字', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: '1 union select 1,2,3' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('检测到 or 1=1 模式', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: "1' or '1'='1" },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('检测到 and 1=1 模式', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: "1' and '1'='1" },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('检测到 xp_ 存储过程', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: 'xp_cmdshell' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('检测到 sp_ 存储过程', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: 'sp_executesql' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('字符串长度小于 5 时跳过检测', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: 'abc' },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('非字符串 query 参数跳过检测', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { page: 1 as unknown as string, limit: 10 as unknown as string },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('query 参数为 null 时不报错', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: null },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('嵌套 query 对象中的注入也能检测到', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { filter: { name: 'select from users' } },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });
  });

  describe('GET 请求 params 参数检测', () => {
    it('正常 params 通过检测', () => {
      const req = createMockReq({
        path: '/api/patients/1',
        method: 'GET',
        params: { id: '1' },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('params 中包含 SQL 注入抛出 400', () => {
      const req = createMockReq({
        path: '/api/patients/1',
        method: 'GET',
        params: { id: "1' or '1'='1" },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('params 数组中的注入也能检测到', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        params: { ids: ['1', 'select from users'] },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });
  });

  describe('DELETE 请求检测', () => {
    it('DELETE 请求检测 query 参数', () => {
      const req = createMockReq({
        path: '/api/patients/1',
        method: 'DELETE',
        query: { reason: 'drop table users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('DELETE 请求检测 params 参数', () => {
      const req = createMockReq({
        path: '/api/patients/1',
        method: 'DELETE',
        params: { id: "1'; delete from users--" },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });
  });

  describe('POST 请求 body 检测', () => {
    it('正常 body 通过检测', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: { name: '张三', age: 30 },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('body 中包含 select from 抛出 400', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: { name: 'select from users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('body 中包含 insert into 抛出 400', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: { name: 'insert into users values' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('body 中包含 update set 抛出 400', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: { name: 'update set password=123' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('body 中包含 delete from 抛出 400', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: { name: 'delete from users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('嵌套 body 对象中的注入也能检测到', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: { contact: { email: 'select from users@test.com' } },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('body 数组中的注入也能检测到', () => {
      const req = createMockReq({
        path: '/api/patients/batch',
        method: 'POST',
        body: [{ name: '张三' }, { name: 'drop table patients' }],
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('body 为 null 时不报错', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: null,
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('body 为 undefined 时不报错', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'POST',
        body: undefined,
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('PUT 请求 body 检测', () => {
    it('PUT 请求检测 body', () => {
      const req = createMockReq({
        path: '/api/patients/1',
        method: 'PUT',
        body: { name: 'alter table users add column' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });
  });

  describe('PATCH 请求 body 检测', () => {
    it('PATCH 请求检测 body', () => {
      const req = createMockReq({
        path: '/api/patients/1',
        method: 'PATCH',
        body: { name: 'truncate table users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });
  });

  describe('其他 HTTP 方法', () => {
    it('OPTIONS 请求跳过检测', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'OPTIONS',
        query: { q: 'select from users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('HEAD 请求跳过检测', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'HEAD',
        query: { q: 'select from users' },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('大小写不敏感', () => {
    it('大写 SQL 关键字也能检测到', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: 'SELECT FROM USERS' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('混合大小写也能检测到', () => {
      const req = createMockReq({
        path: '/api/patients',
        method: 'GET',
        query: { q: 'SeLeCt FrOm UsErS' },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });
  });

  describe('深层嵌套对象检测', () => {
    it('三层嵌套对象中的注入也能检测到', () => {
      const req = createMockReq({
        path: '/api/test',
        method: 'POST',
        body: {
          level1: {
            level2: {
              level3: 'drop table test',
            },
          },
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });

    it('数组中嵌套对象的注入也能检测到', () => {
      const req = createMockReq({
        path: '/api/test',
        method: 'POST',
        body: {
          items: [
            { id: 1, name: 'test' },
            { id: 2, name: 'select from test' },
          ],
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    });
  });
});
