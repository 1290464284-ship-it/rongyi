import { isPhoneNumber, validatePhoneNumber, normalizePhone } from './phone.utils';

describe('phone.utils', () => {
  describe('isPhoneNumber', () => {
    it('有效的11位手机号应返回 true', () => {
      expect(isPhoneNumber('13800138000')).toBe(true);
      expect(isPhoneNumber('13912345678')).toBe(true);
      expect(isPhoneNumber('15900001111')).toBe(true);
      expect(isPhoneNumber('18600002222')).toBe(true);
      expect(isPhoneNumber('19900003333')).toBe(true);
    });

    it('第二位为 3-9 都应有效', () => {
      expect(isPhoneNumber('13000000000')).toBe(true);
      expect(isPhoneNumber('14000000000')).toBe(true);
      expect(isPhoneNumber('15000000000')).toBe(true);
      expect(isPhoneNumber('16000000000')).toBe(true);
      expect(isPhoneNumber('17000000000')).toBe(true);
      expect(isPhoneNumber('18000000000')).toBe(true);
      expect(isPhoneNumber('19000000000')).toBe(true);
    });

    it('非1开头的号码应返回 false', () => {
      expect(isPhoneNumber('23800138000')).toBe(false);
      expect(isPhoneNumber('03800138000')).toBe(false);
    });

    it('第二位为 0-2 的号码应返回 false', () => {
      expect(isPhoneNumber('10000000000')).toBe(false);
      expect(isPhoneNumber('11000000000')).toBe(false);
      expect(isPhoneNumber('12000000000')).toBe(false);
    });

    it('长度不等于11位的号码应返回 false', () => {
      expect(isPhoneNumber('1380013800')).toBe(false);
      expect(isPhoneNumber('138001380000')).toBe(false);
      expect(isPhoneNumber('138')).toBe(false);
      expect(isPhoneNumber('')).toBe(false);
    });

    it('包含非数字字符的应返回 false', () => {
      expect(isPhoneNumber('138-0013-8000')).toBe(false);
      expect(isPhoneNumber('138 0013 8000')).toBe(false);
      expect(isPhoneNumber('138a0013800')).toBe(false);
    });

    it('null/undefined 应返回 false', () => {
      expect(isPhoneNumber(null)).toBe(false);
      expect(isPhoneNumber(undefined)).toBe(false);
    });
  });

  describe('validatePhoneNumber', () => {
    it('有效的手机号不应抛出异常', () => {
      expect(() => validatePhoneNumber('13800138000')).not.toThrow();
    });

    it('无效的手机号应抛出异常', () => {
      expect(() => validatePhoneNumber('invalid')).toThrow('手机号格式不正确，请输入11位中国大陆手机号');
    });

    it('可自定义字段名', () => {
      expect(() => validatePhoneNumber('invalid', '紧急联系人电话')).toThrow('紧急联系人电话格式不正确');
    });

    it('空字符串应抛出异常', () => {
      expect(() => validatePhoneNumber('')).toThrow();
    });
  });

  describe('normalizePhone', () => {
    it('应去除空格', () => {
      expect(normalizePhone('138 0013 8000')).toBe('13800138000');
      expect(normalizePhone(' 13800138000 ')).toBe('13800138000');
    });

    it('应去除横线', () => {
      expect(normalizePhone('138-0013-8000')).toBe('13800138000');
    });

    it('应去除 +86 前缀', () => {
      expect(normalizePhone('+8613800138000')).toBe('13800138000');
      expect(normalizePhone('+86 138-0013-8000')).toBe('13800138000');
    });

    it('应去除 86 前缀（13位时）', () => {
      expect(normalizePhone('8613800138000')).toBe('13800138000');
    });

    it('11位且以86开头的不应被误处理', () => {
      expect(normalizePhone('86123456789')).toBe('86123456789');
    });

    it('纯数字手机号应原样返回', () => {
      expect(normalizePhone('13800138000')).toBe('13800138000');
    });

    it('null/undefined 应返回 null', () => {
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone(undefined)).toBeNull();
    });

    it('空字符串应返回 null', () => {
      expect(normalizePhone('')).toBeNull();
    });

    describe('组合情况', () => {
      it('+86 + 空格 + 横线的组合应正确规范化', () => {
        expect(normalizePhone('+86 138-0013-8000')).toBe('13800138000');
      });

      it('86 + 空格 + 横线的组合应正确规范化', () => {
        expect(normalizePhone('86 138-0013-8000')).toBe('13800138000');
      });
    });
  });
});
