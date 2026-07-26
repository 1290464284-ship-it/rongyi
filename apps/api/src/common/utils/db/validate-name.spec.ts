import { validateTableName, validateColumnName, escapeLike, COLUMN_NAME_REGEX } from './validate-name';

describe('validate-name', () => {
  describe('validateTableName', () => {
    it('有效的表名应返回 true', () => {
      expect(validateTableName('users')).toBe(true);
      expect(validateTableName('user_profiles')).toBe(true);
      expect(validateTableName('User')).toBe(true);
      expect(validateTableName('_private_table')).toBe(true);
      expect(validateTableName('table123')).toBe(true);
      expect(validateTableName('a')).toBe(true);
      expect(validateTableName('A')).toBe(true);
      expect(validateTableName('_')).toBe(true);
    });

    it('无效的表名应返回 false', () => {
      expect(validateTableName('')).toBe(false);
      expect(validateTableName('123table')).toBe(false);
      expect(validateTableName('user-table')).toBe(false);
      expect(validateTableName('user table')).toBe(false);
      expect(validateTableName('user.table')).toBe(false);
      expect(validateTableName('user;DROP TABLE users')).toBe(false);
      expect(validateTableName("user'; DROP TABLE users;--")).toBe(false);
      expect(validateTableName('用户表')).toBe(false);
      expect(validateTableName('user$')).toBe(false);
      expect(validateTableName('user@name')).toBe(false);
    });
  });

  describe('validateColumnName', () => {
    it('有效的列名应返回 true', () => {
      expect(validateColumnName('name')).toBe(true);
      expect(validateColumnName('user_id')).toBe(true);
      expect(validateColumnName('createdAt')).toBe(true);
      expect(validateColumnName('Created_At')).toBe(true);
      expect(validateColumnName('_internal_field')).toBe(true);
      expect(validateColumnName('col1')).toBe(true);
      expect(validateColumnName('a')).toBe(true);
    });

    it('无效的列名应返回 false', () => {
      expect(validateColumnName('')).toBe(false);
      expect(validateColumnName('1name')).toBe(false);
      expect(validateColumnName('user-name')).toBe(false);
      expect(validateColumnName('user name')).toBe(false);
      expect(validateColumnName('user.name')).toBe(false);
      expect(validateColumnName("name'; DROP TABLE users;--")).toBe(false);
      expect(validateColumnName('列名')).toBe(false);
      expect(validateColumnName('name$')).toBe(false);
    });

    it('COLUMN_NAME_REGEX 应与 validateColumnName 行为一致', () => {
      const testCases = ['name', 'user_id', '1invalid', 'user-name'];
      for (const name of testCases) {
        expect(COLUMN_NAME_REGEX.test(name)).toBe(validateColumnName(name));
      }
    });
  });

  describe('escapeLike', () => {
    it('应转义 % 字符', () => {
      expect(escapeLike('test%value')).toBe('test\\%value');
      expect(escapeLike('%start')).toBe('\\%start');
      expect(escapeLike('end%')).toBe('end\\%');
    });

    it('应转义 _ 字符', () => {
      expect(escapeLike('test_value')).toBe('test\\_value');
      expect(escapeLike('_start')).toBe('\\_start');
      expect(escapeLike('end_')).toBe('end\\_');
    });

    it('应转义反斜杠字符', () => {
      expect(escapeLike('test\\value')).toBe('test\\\\value');
    });

    it('应同时转义多种特殊字符', () => {
      expect(escapeLike('%test_value\\')).toBe('\\%test\\_value\\\\');
    });

    it('普通字符串应原样返回', () => {
      expect(escapeLike('hello world')).toBe('hello world');
      expect(escapeLike('')).toBe('');
      expect(escapeLike('12345')).toBe('12345');
    });

    it('SQL 注入字符应被正确转义', () => {
      expect(escapeLike("' OR 1=1--")).toBe("' OR 1=1--");
    });

    describe('边界情况', () => {
      it('空字符串应返回空字符串', () => {
        expect(escapeLike('')).toBe('');
      });

      it('全是特殊字符的字符串应全部转义', () => {
        expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
      });

      it('连续特殊字符应分别转义', () => {
        expect(escapeLike('%%__')).toBe('\\%\\%\\_\\_');
      });
    });
  });
});
