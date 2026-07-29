import { UpdateBuilder, updateBuilder, buildUpdate } from './sql-builder';

jest.mock('../format/date', () => ({
  nowISO: jest.fn(() => '2024-01-15T10:30:00.000Z'),
}));

describe('sql-builder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('UpdateBuilder', () => {
    describe('set()', () => {
      it('应添加单个字段更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('name', '张三');
        const result = builder.build('1');
        expect(result).not.toBeNull();
        expect(result!.sql).toBe('UPDATE users SET name = ? WHERE id = ?');
        expect(result!.params).toEqual(['张三', '1']);
      });

      it('应添加多个字段更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('name', '张三');
        builder.set('age', 30);
        builder.set('email', 'test@example.com');
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET name = ?, age = ?, email = ? WHERE id = ?');
        expect(result!.params).toEqual(['张三', 30, 'test@example.com', '1']);
      });

      it('condition 为 false 时不应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('name', '张三', false);
        builder.set('age', 30, true);
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET age = ? WHERE id = ?');
        expect(result!.params).toEqual([30, '1']);
      });

      it('undefined 值不应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('name', undefined);
        builder.set('age', 30);
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET age = ? WHERE id = ?');
        expect(result!.params).toEqual([30, '1']);
      });

      it('null 值应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('name', null);
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET name = ? WHERE id = ?');
        expect(result!.params).toEqual([null, '1']);
      });

      it('空字符串应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('name', '');
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET name = ? WHERE id = ?');
        expect(result!.params).toEqual(['', '1']);
      });

      it('0 值应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('count', 0);
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET count = ? WHERE id = ?');
        expect(result!.params).toEqual([0, '1']);
      });

      it('false 值应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.set('active', false);
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET active = ? WHERE id = ?');
        expect(result!.params).toEqual([false, '1']);
      });

      it('非法字段名应抛出错误', () => {
        const builder = new UpdateBuilder('users');
        expect(() => builder.set('name; DROP TABLE users--', 'test')).toThrow('Invalid field name');
      });

      it('支持链式调用', () => {
        const builder = new UpdateBuilder('users');
        const result = builder.set('name', '张三').set('age', 30).build('1');
        expect(result).not.toBeNull();
        expect(result!.sql).toBe('UPDATE users SET name = ?, age = ? WHERE id = ?');
      });
    });

    describe('setExpression()', () => {
      it('应设置字面量表达式', () => {
        const builder = new UpdateBuilder('users');
        builder.setExpression('count', 'count + 1');
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET count = count + 1 WHERE id = ?');
        expect(result!.params).toEqual(['1']);
      });

      it('非法字段名应抛出错误', () => {
        const builder = new UpdateBuilder('users');
        expect(() => builder.setExpression('name; DROP TABLE--', '1')).toThrow('Invalid field name');
      });
    });

    describe('increment()', () => {
      it('应增加字段值', () => {
        const builder = new UpdateBuilder('users');
        builder.increment('count', 5);
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET count = count + ? WHERE id = ?');
        expect(result!.params).toEqual([5, '1']);
      });

      it('应减少字段值（负数）', () => {
        const builder = new UpdateBuilder('users');
        builder.increment('count', -3);
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET count = count + ? WHERE id = ?');
        expect(result!.params).toEqual([-3, '1']);
      });

      it('delta 为 0 时不应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.increment('count', 0);
        const result = builder.build('1');
        expect(result).toBeNull();
      });

      it('condition 为 false 时不应添加更新', () => {
        const builder = new UpdateBuilder('users');
        builder.increment('count', 5, false);
        const result = builder.build('1');
        expect(result).toBeNull();
      });

      it('非法字段名应抛出错误', () => {
        const builder = new UpdateBuilder('users');
        expect(() => builder.increment('count; DROP TABLE--', 1)).toThrow('Invalid field name');
      });
    });

    describe('setUpdatedAt()', () => {
      it('应设置 updatedAt 为当前时间', () => {
        const builder = new UpdateBuilder('users');
        builder.setUpdatedAt();
        const result = builder.build('1');
        expect(result!.sql).toBe('UPDATE users SET updatedAt = ? WHERE id = ?');
        expect(result!.params[0]).toBe('2024-01-15T10:30:00.000Z');
        expect(result!.params[1]).toBe('1');
      });
    });

    describe('build()', () => {
      it('没有更新时应返回 null', () => {
        const builder = new UpdateBuilder('users');
        const result = builder.build('1');
        expect(result).toBeNull();
      });

      it('应正确构建带 id 的 UPDATE 语句', () => {
        const builder = new UpdateBuilder('users');
        builder.set('name', '张三');
        const result = builder.build('user-123');
        expect(result!.sql).toBe('UPDATE users SET name = ? WHERE id = ?');
        expect(result!.params).toEqual(['张三', 'user-123']);
      });
    });

    describe('buildWithCustomWhere()', () => {
      it('应使用自定义 WHERE 子句', () => {
        const builder = new UpdateBuilder('users');
        builder.set('status', 'active');
        const result = builder.buildWithCustomWhere('clinicId = ? AND role = ?', ['clinic-1', 'admin']);
        expect(result!.sql).toBe('UPDATE users SET status = ? WHERE clinicId = ? AND role = ?');
        expect(result!.params).toEqual(['active', 'clinic-1', 'admin']);
      });

      it('没有更新时应返回 null', () => {
        const builder = new UpdateBuilder('users');
        const result = builder.buildWithCustomWhere('id = ?', ['1']);
        expect(result).toBeNull();
      });
    });
  });

  describe('updateBuilder()', () => {
    it('应创建 UpdateBuilder 实例', () => {
      const builder = updateBuilder('users');
      expect(builder).toBeInstanceOf(UpdateBuilder);
    });
  });

  describe('buildUpdate()', () => {
    it('应从对象构建 UPDATE 语句并自动添加 updatedAt', () => {
      const data = { name: '张三', age: 30 };
      const result = buildUpdate('users', '1', data);
      expect(result).not.toBeNull();
      expect(result!.sql).toContain('UPDATE users SET');
      expect(result!.sql).toContain('name = ?');
      expect(result!.sql).toContain('age = ?');
      expect(result!.sql).toContain('updatedAt = ?');
      expect(result!.sql).toContain('WHERE id = ?');
      expect(result!.params).toContain('张三');
      expect(result!.params).toContain(30);
      expect(result!.params).toContain('2024-01-15T10:30:00.000Z');
      expect(result!.params).toContain('1');
    });

    it('空对象应返回 null（只有 updatedAt）', () => {
      const result = buildUpdate('users', '1', {});
      expect(result).not.toBeNull();
      expect(result!.sql).toContain('updatedAt = ?');
    });

    it('undefined 值应被跳过', () => {
      const data = { name: '张三', age: undefined };
      const result = buildUpdate('users', '1', data);
      expect(result!.sql).toContain('name = ?');
      expect(result!.sql).not.toContain('age = ?');
    });
  });
});
