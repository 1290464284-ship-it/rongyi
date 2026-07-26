import { safeJsonParse, safeJsonArray } from './json.utils';

describe('json.utils', () => {
  describe('safeJsonParse', () => {
    it('应正确解析有效的 JSON 字符串', () => {
      expect(safeJsonParse('{"name":"test","value":123}')).toEqual({ name: 'test', value: 123 });
      expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
      expect(safeJsonParse('"hello"')).toBe('hello');
      expect(safeJsonParse('123')).toBe(123);
      expect(safeJsonParse('true')).toBe(true);
      expect(safeJsonParse('null')).toBeNull();
    });

    it('无效的 JSON 应返回默认值', () => {
      expect(safeJsonParse('invalid json')).toBeNull();
      expect(safeJsonParse('{invalid}')).toBeNull();
      expect(safeJsonParse('[1,2,]')).toBeNull();
    });

    it('可自定义默认值', () => {
      expect(safeJsonParse('invalid', {})).toEqual({});
      expect(safeJsonParse('invalid', [])).toEqual([]);
      expect(safeJsonParse('invalid', 'fallback')).toBe('fallback');
      expect(safeJsonParse('invalid', 0)).toBe(0);
      expect(safeJsonParse('invalid', false)).toBe(false);
    });

    it('null 输入应返回默认值', () => {
      expect(safeJsonParse(null)).toBeNull();
      expect(safeJsonParse(null, 'default')).toBe('default');
    });

    it('undefined 输入应返回默认值', () => {
      expect(safeJsonParse(undefined)).toBeNull();
      expect(safeJsonParse(undefined, 'default')).toBe('default');
    });

    it('非字符串输入应直接返回原值', () => {
      const obj = { a: 1 };
      expect(safeJsonParse(obj as unknown as string)).toBe(obj);
      expect(safeJsonParse(123 as unknown as string)).toBe(123);
      expect(safeJsonParse(true as unknown as string)).toBe(true);
    });

    it('空字符串应返回默认值', () => {
      expect(safeJsonParse('')).toBeNull();
    });

    it('空白字符串应返回默认值', () => {
      expect(safeJsonParse('   ')).toBeNull();
    });
  });

  describe('safeJsonArray', () => {
    it('应正确解析 JSON 数组', () => {
      expect(safeJsonArray('[1,2,3]')).toEqual([1, 2, 3]);
      expect(safeJsonArray('[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
      expect(safeJsonArray('[]')).toEqual([]);
    });

    it('解析非数组 JSON 时应返回空数组', () => {
      expect(safeJsonArray('{"name":"test"}')).toEqual([]);
      expect(safeJsonArray('"hello"')).toEqual([]);
      expect(safeJsonArray('123')).toEqual([]);
      expect(safeJsonArray('true')).toEqual([]);
      expect(safeJsonArray('null')).toEqual([]);
    });

    it('无效 JSON 应返回空数组', () => {
      expect(safeJsonArray('invalid')).toEqual([]);
      expect(safeJsonArray('{invalid}')).toEqual([]);
    });

    it('null 输入应返回空数组', () => {
      expect(safeJsonArray(null)).toEqual([]);
    });

    it('undefined 输入应返回空数组', () => {
      expect(safeJsonArray(undefined)).toEqual([]);
    });

    it('空字符串应返回空数组', () => {
      expect(safeJsonArray('')).toEqual([]);
    });

    it('应支持泛型类型', () => {
      interface Item { id: number; name: string }
      const result = safeJsonArray<Item>('[{"id":1,"name":"a"}]');
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe('a');
    });

    describe('常见使用场景', () => {
      it('teethNumbers 数组场景', () => {
        const teethNumbers = safeJsonArray<number>('[11,12,21,22]');
        expect(teethNumbers).toEqual([11, 12, 21, 22]);
        expect(Array.isArray(teethNumbers)).toBe(true);
      });

      it('diseases 数组场景', () => {
        const diseases = safeJsonArray<string>('["龋齿","牙周炎"]');
        expect(diseases).toEqual(['龋齿', '牙周炎']);
      });

      it('数据库脏数据场景（非数组）应安全降级', () => {
        const result = safeJsonArray('{"invalid": true}');
        expect(result).toEqual([]);
        expect(Array.isArray(result)).toBe(true);
      });
    });
  });
});
