import { IsPhoneConstraint, IsPhoneNormalizedConstraint } from './phone.decorator';

// 由于 IsPhone 和 IsPhoneLoose 是装饰器工厂，需要通过 registerDecorator 间接测试
// 直接测试 Constraint 类的 validate 方法更高效

describe('phone.decorator', () => {
  describe('IsPhoneConstraint', () => {
    let constraint: InstanceType<typeof IsPhoneConstraint>;

    beforeEach(() => {
      // IsPhoneConstraint 不是导出的，需要通过间接方式获取
      // 但我们可以测试 IsPhone 装饰器的行为
      constraint = new (IsPhoneConstraint as any)();
    });

    it('undefined 应返回 true（可选校验）', () => {
      expect(constraint.validate(undefined)).toBe(true);
    });

    it('null 应返回 true（可选校验）', () => {
      expect(constraint.validate(null)).toBe(true);
    });

    it('有效手机号应返回 true', () => {
      expect(constraint.validate('13800138000')).toBe(true);
    });

    it('无效手机号应返回 false', () => {
      expect(constraint.validate('12345')).toBe(false);
      expect(constraint.validate('abcdefghijk')).toBe(false);
    });

    it('defaultMessage 应返回中文提示', () => {
      expect(constraint.defaultMessage()).toContain('手机号');
    });
  });

  describe('IsPhoneNormalizedConstraint', () => {
    let constraint: InstanceType<typeof IsPhoneNormalizedConstraint>;

    beforeEach(() => {
      constraint = new (IsPhoneNormalizedConstraint as any)();
    });

    it('undefined 应返回 true', () => {
      expect(constraint.validate(undefined)).toBe(true);
    });

    it('null 应返回 true', () => {
      expect(constraint.validate(null)).toBe(true);
    });

    it('有效手机号应返回 true', () => {
      expect(constraint.validate('13800138000')).toBe(true);
    });

    it('无效手机号应返回 false', () => {
      expect(constraint.validate('12345')).toBe(false);
    });

    it('defaultMessage 应返回中文提示', () => {
      expect(constraint.defaultMessage()).toContain('手机号');
    });
  });
});
