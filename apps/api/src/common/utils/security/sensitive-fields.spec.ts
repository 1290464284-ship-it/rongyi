import { SENSITIVE_FIELDS, isSensitiveField } from './sensitive-fields';

describe('sensitive-fields', () => {
  describe('SENSITIVE_FIELDS 常量', () => {
    it('应包含密码相关字段', () => {
      expect(SENSITIVE_FIELDS).toContain('password');
      expect(SENSITIVE_FIELDS).toContain('passwordhash');
    });

    it('应包含令牌相关字段', () => {
      expect(SENSITIVE_FIELDS).toContain('token');
      expect(SENSITIVE_FIELDS).toContain('refreshtoken');
      expect(SENSITIVE_FIELDS).toContain('jwtsecret');
    });

    it('应包含密钥相关字段', () => {
      expect(SENSITIVE_FIELDS).toContain('secret');
      expect(SENSITIVE_FIELDS).toContain('key');
    });

    it('应包含患者隐私字段', () => {
      expect(SENSITIVE_FIELDS).toContain('idcard');
      expect(SENSITIVE_FIELDS).toContain('身份证');
      expect(SENSITIVE_FIELDS).toContain('phone');
      expect(SENSITIVE_FIELDS).toContain('email');
      expect(SENSITIVE_FIELDS).toContain('address');
      expect(SENSITIVE_FIELDS).toContain('cardno');
      expect(SENSITIVE_FIELDS).toContain('openid');
    });

    it('数组长度应正确', () => {
      expect(SENSITIVE_FIELDS.length).toBeGreaterThan(10);
    });
  });

  describe('isSensitiveField', () => {
    describe('精确匹配的敏感字段', () => {
      it('password 应识别为敏感字段', () => {
        expect(isSensitiveField('password')).toBe(true);
      });

      it('token 应识别为敏感字段', () => {
        expect(isSensitiveField('token')).toBe(true);
      });

      it('secret 应识别为敏感字段', () => {
        expect(isSensitiveField('secret')).toBe(true);
      });

      it('phone 应识别为敏感字段', () => {
        expect(isSensitiveField('phone')).toBe(true);
      });

      it('email 应识别为敏感字段', () => {
        expect(isSensitiveField('email')).toBe(true);
      });

      it('idcard 应识别为敏感字段', () => {
        expect(isSensitiveField('idcard')).toBe(true);
      });

      it('身份证 应识别为敏感字段', () => {
        expect(isSensitiveField('身份证')).toBe(true);
      });

      it('openid 应识别为敏感字段', () => {
        expect(isSensitiveField('openid')).toBe(true);
      });
    });

    describe('扩展关键词匹配', () => {
      it('creditcard 应识别为敏感字段', () => {
        expect(isSensitiveField('creditcard')).toBe(true);
      });

      it('authorization 应识别为敏感字段', () => {
        expect(isSensitiveField('authorization')).toBe(true);
      });

      it('cookie 应识别为敏感字段', () => {
        expect(isSensitiveField('cookie')).toBe(true);
      });

      it('credential 应识别为敏感字段', () => {
        expect(isSensitiveField('credential')).toBe(true);
      });

      it('ssn 应识别为敏感字段', () => {
        expect(isSensitiveField('ssn')).toBe(true);
      });

      it('cvv 应识别为敏感字段', () => {
        expect(isSensitiveField('cvv')).toBe(true);
      });
    });

    describe('大小写不敏感', () => {
      it('Password 应识别为敏感字段', () => {
        expect(isSensitiveField('Password')).toBe(true);
      });

      it('PASSWORD 应识别为敏感字段', () => {
        expect(isSensitiveField('PASSWORD')).toBe(true);
      });

      it('Token 应识别为敏感字段', () => {
        expect(isSensitiveField('Token')).toBe(true);
      });

      it('Phone 应识别为敏感字段', () => {
        expect(isSensitiveField('Phone')).toBe(true);
      });
    });

    describe('非敏感字段不应误匹配', () => {
      it('keyword 不应因子串匹配而被识别为敏感', () => {
        expect(isSensitiveField('keyword')).toBe(false);
      });

      it('sortKey 不应因子串匹配而被识别为敏感', () => {
        expect(isSensitiveField('sortKey')).toBe(false);
      });

      it('keyboard 不应因子串匹配而被识别为敏感', () => {
        expect(isSensitiveField('keyboard')).toBe(false);
      });

      it('phoneNumber 不应因子串匹配而被识别为敏感', () => {
        expect(isSensitiveField('phoneNumber')).toBe(false);
      });

      it('secretKey 不应因子串匹配而被识别为敏感', () => {
        expect(isSensitiveField('secretKey')).toBe(false);
      });
    });

    describe('普通字段', () => {
      it('name 不是敏感字段', () => {
        expect(isSensitiveField('name')).toBe(false);
      });

      it('age 不是敏感字段', () => {
        expect(isSensitiveField('age')).toBe(false);
      });

      it('id 不是敏感字段', () => {
        expect(isSensitiveField('id')).toBe(false);
      });

      it('createdAt 不是敏感字段', () => {
        expect(isSensitiveField('createdAt')).toBe(false);
      });

      it('status 不是敏感字段', () => {
        expect(isSensitiveField('status')).toBe(false);
      });
    });

    describe('边界情况', () => {
      it('空字符串不是敏感字段', () => {
        expect(isSensitiveField('')).toBe(false);
      });

      it('单字符不是敏感字段', () => {
        expect(isSensitiveField('a')).toBe(false);
      });

      it('数字不是敏感字段', () => {
        expect(isSensitiveField('123')).toBe(false);
      });

      it('特殊字符不是敏感字段', () => {
        expect(isSensitiveField('@#$')).toBe(false);
      });
    });
  });
});
