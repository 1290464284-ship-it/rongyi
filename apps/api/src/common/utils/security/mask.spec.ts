import fc from 'fast-check';
import { maskIdCard, maskPhone, maskEmail, maskName } from './mask';

describe('mask utils', () => {
  describe('maskIdCard', () => {
    it('应正确脱敏身份证号', () => {
      expect(maskIdCard('110101199001011234')).toBe('110101********1234');
    });

    it('18 位身份证应正确脱敏', () => {
      expect(maskIdCard('11010119900101123X')).toBe('110101********123X');
    });

    it('15 位身份证也用 8 个星号脱敏中间', () => {
      const result = maskIdCard('110101900101123');
      expect(result).toBe('110101********1123');
    });

    it('长度不足 10 位应原样返回', () => {
      expect(maskIdCard('123456789')).toBe('123456789');
      expect(maskIdCard('123')).toBe('123');
    });

    it('空值应返回 null', () => {
      expect(maskIdCard(null)).toBeNull();
      expect(maskIdCard(undefined)).toBeNull();
      expect(maskIdCard('')).toBeNull();
    });
  });

  describe('maskPhone', () => {
    it('应正确脱敏手机号', () => {
      expect(maskPhone('13800138000')).toBe('138****8000');
    });

    it('长度不足 7 位应原样返回', () => {
      expect(maskPhone('123456')).toBe('123456');
      expect(maskPhone('123')).toBe('123');
    });

    it('7 位手机号也用 4 个星号脱敏中间', () => {
      expect(maskPhone('1234567')).toBe('123****4567');
    });

    it('空值应返回 null', () => {
      expect(maskPhone(null)).toBeNull();
      expect(maskPhone(undefined)).toBeNull();
      expect(maskPhone('')).toBeNull();
    });
  });

  describe('maskEmail', () => {
    it('应正确脱敏邮箱', () => {
      expect(maskEmail('zhangsan@example.com')).toBe('zh***@example.com');
    });

    it('用户名只有 1 位时应保留全部', () => {
      expect(maskEmail('a@example.com')).toBe('a***@example.com');
    });

    it('用户名只有 2 位时应保留全部', () => {
      expect(maskEmail('ab@example.com')).toBe('ab***@example.com');
    });

    it('不含 @ 应原样返回', () => {
      expect(maskEmail('notanemail')).toBe('notanemail');
    });

    it('空值应返回 null', () => {
      expect(maskEmail(null)).toBeNull();
      expect(maskEmail(undefined)).toBeNull();
      expect(maskEmail('')).toBeNull();
    });

    it('域名应完整保留', () => {
      const result = maskEmail('user@sub.example.com');
      expect(result).toContain('@sub.example.com');
    });
  });

  describe('maskName', () => {
    it('两个字的姓名应正确脱敏', () => {
      expect(maskName('张三')).toBe('张*');
    });

    it('三个字的姓名应正确脱敏', () => {
      expect(maskName('欧阳修')).toBe('欧**');
    });

    it('英文名应正确脱敏', () => {
      expect(maskName('John')).toBe('J***');
    });

    it('长度为 1 应原样返回', () => {
      expect(maskName('张')).toBe('张');
      expect(maskName('A')).toBe('A');
    });

    it('空值应返回 null', () => {
      expect(maskName(null)).toBeNull();
      expect(maskName(undefined)).toBeNull();
      expect(maskName('')).toBeNull();
    });

    it('多字姓名应正确脱敏', () => {
      expect(maskName('欧阳锋')).toBe('欧**');
      expect(maskName('司马相如')).toBe('司***');
    });
  });

  describe('属性测试 (fast-check)', () => {
    const genDigitString = (minLen: number, maxLen: number) =>
      fc
        .array(fc.integer({ min: 0, max: 9 }), { minLength: minLen, maxLength: maxLen })
        .map((arr) => arr.join(''));

    const idCard18 = genDigitString(18, 18);
    const phone11 = genDigitString(11, 11);

    describe('maskIdCard 属性测试', () => {
      it('对于18位身份证，前6后4保留，中间8个*', () => {
        const property = fc.property(idCard18, (idCard: string) => {
          const result = maskIdCard(idCard);
          if (result === null) return false;
          return (
            result.length === 18 &&
            result.startsWith(idCard.slice(0, 6)) &&
            result.endsWith(idCard.slice(Math.max(0, idCard.length - 4))) &&
            result.slice(6, 14) === '********'
          );
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('输入为 null 时返回 null', () => {
        expect(maskIdCard(null)).toBeNull();
      });

      it('输入为 undefined 时返回 null', () => {
        expect(maskIdCard(undefined)).toBeNull();
      });

      it('输入为空字符串时返回 null', () => {
        expect(maskIdCard('')).toBeNull();
      });

      it('长度不足10位时原样返回', () => {
        const property = fc.property(genDigitString(1, 9), (idCard: string) => {
          const result = maskIdCard(idCard);
          return result === idCard;
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('脱敏后长度固定为18位（长度>=10时）', () => {
        const property = fc.property(genDigitString(10, 30), (idCard: string) => {
          const result = maskIdCard(idCard);
          return result !== null && result.length === 18;
        });
        expect(fc.assert(property)).toBe(undefined);
      });
    });

    describe('maskPhone 属性测试', () => {
      it('对于11位手机号，前3后4保留，中间4个*', () => {
        const property = fc.property(phone11, (phone: string) => {
          const result = maskPhone(phone);
          if (result === null) return false;
          return (
            result.length === 11 &&
            result.startsWith(phone.slice(0, 3)) &&
            result.endsWith(phone.slice(Math.max(0, phone.length - 4))) &&
            result.slice(3, 7) === '****'
          );
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('输入为 null 时返回 null', () => {
        expect(maskPhone(null)).toBeNull();
      });

      it('输入为 undefined 时返回 null', () => {
        expect(maskPhone(undefined)).toBeNull();
      });

      it('输入为空字符串时返回 null', () => {
        expect(maskPhone('')).toBeNull();
      });

      it('长度不足7位时原样返回', () => {
        const property = fc.property(genDigitString(1, 6), (phone: string) => {
          const result = maskPhone(phone);
          return result === phone;
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('脱敏后长度固定为11位（长度>=7时）', () => {
        const property = fc.property(genDigitString(7, 20), (phone: string) => {
          const result = maskPhone(phone);
          return result !== null && result.length === 11;
        });
        expect(fc.assert(property)).toBe(undefined);
      });
    });

    describe('maskEmail 属性测试', () => {
      const validEmail = fc
        .tuple(
          fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/),
          fc.stringMatching(/^[a-z]{1,10}\.[a-z]{2,5}$/)
        )
        .map(([user, domain]) => `${user}@${domain}`);

      it('输入为 null/undefined/空字符串时返回 null', () => {
        expect(maskEmail(null)).toBeNull();
        expect(maskEmail(undefined)).toBeNull();
        expect(maskEmail('')).toBeNull();
      });

      it('不含@的字符串原样返回', () => {
        const property = fc.property(fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/), (str: string) => {
          const result = maskEmail(str);
          return result === str;
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('脱敏后域名部分保持不变', () => {
        const property = fc.property(validEmail, (email: string) => {
          const result = maskEmail(email);
          if (result === null) return false;
          const atIndex = email.indexOf('@');
          const domain = email.slice(Math.max(0, atIndex));
          return result.endsWith(domain);
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('脱敏后包含 ***', () => {
        const property = fc.property(validEmail, (email: string) => {
          const result = maskEmail(email);
          return result !== null && result.includes('***');
        });
        expect(fc.assert(property)).toBe(undefined);
      });
    });

    describe('maskName 属性测试', () => {
      it('输入为 null/undefined/空字符串时返回 null', () => {
        expect(maskName(null)).toBeNull();
        expect(maskName(undefined)).toBeNull();
        expect(maskName('')).toBeNull();
      });

      it('长度为1时原样返回', () => {
        const property = fc.property(fc.string({ minLength: 1, maxLength: 1 }), (name: string) => {
          return maskName(name) === name;
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('脱敏后第一个字符与原字符串第一个字符相同', () => {
        const property = fc.property(fc.string({ minLength: 2, maxLength: 20 }), (name: string) => {
          const result = maskName(name);
          return result !== null && result.charAt(0) === name.charAt(0);
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('脱敏后长度与原长度相同', () => {
        const property = fc.property(fc.string({ minLength: 1, maxLength: 20 }), (name: string) => {
          const result = maskName(name);
          return result === null || result.length === name.length;
        });
        expect(fc.assert(property)).toBe(undefined);
      });

      it('脱敏后除第一个字符外其余都是*（长度>=2时）', () => {
        const property = fc.property(fc.string({ minLength: 2, maxLength: 20 }), (name: string) => {
          const result = maskName(name);
          if (result === null) return false;
          for (let i = 1; i < result.length; i++) {
            if (result.charAt(i) !== '*') return false;
          }
          return true;
        });
        expect(fc.assert(property)).toBe(undefined);
      });
    });
  });
});
