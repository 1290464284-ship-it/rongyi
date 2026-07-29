import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';
import { Role } from '@dental/shared';

describe('UpdateUserDto', () => {
  describe('password 校验', () => {
    it('4位数字密码应通过', async () => {
      const dto = new UpdateUserDto();
      dto.password = '1234';
      const errors = await validate(dto);
      expect(errors.filter(e => e.property === 'password')).toHaveLength(0);
    });

    it('6位以上含字母和数字应通过', async () => {
      const dto = new UpdateUserDto();
      dto.password = 'abc123';
      const errors = await validate(dto);
      expect(errors.filter(e => e.property === 'password')).toHaveLength(0);
    });

    it('纯字母应报错', async () => {
      const dto = new UpdateUserDto();
      dto.password = 'abcdef';
      const errors = await validate(dto);
      expect(errors.filter(e => e.property === 'password').length).toBeGreaterThan(0);
    });

    it('太短的密码应报错', async () => {
      const dto = new UpdateUserDto();
      dto.password = 'ab1';
      const errors = await validate(dto);
      expect(errors.filter(e => e.property === 'password').length).toBeGreaterThan(0);
    });

    it('不满足规则的密码应报错', async () => {
      const dto = new UpdateUserDto();
      dto.password = '12345';
      const errors = await validate(dto);
      expect(errors.filter(e => e.property === 'password').length).toBeGreaterThan(0);
    });
  });

  describe('可选字段', () => {
    it('全部字段有效时应通过', async () => {
      const dto = new UpdateUserDto();
      dto.name = '李医生';
      dto.role = Role.DOCTOR;
      dto.phone = '13800138000';
      dto.active = true;
      dto.password = 'Pass123';
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('空 DTO 应通过（全部可选）', async () => {
      const dto = new UpdateUserDto();
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('无效 role 应报错', async () => {
      const dto = new UpdateUserDto();
      (dto as any).role = 'INVALID_ROLE';
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'role')).toBe(true);
    });

    it('无效 active 类型应报错', async () => {
      const dto = new UpdateUserDto();
      (dto as any).active = 'not-boolean';
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'active')).toBe(true);
    });
  });
});
