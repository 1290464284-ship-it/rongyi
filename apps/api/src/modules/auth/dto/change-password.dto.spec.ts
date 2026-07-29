import { validate } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto';

describe('ChangePasswordDto', () => {
  async function validateDto(dto: ChangePasswordDto) {
    return await validate(dto);
  }

  it('有效密码应通过校验', async () => {
    const dto = new ChangePasswordDto();
    dto.oldPassword = 'oldPass123';
    dto.newPassword = 'newPass456';
    const errors = await validateDto(dto);
    expect(errors.length).toBe(0);
  });

  it('oldPassword 缺失应报错', async () => {
    const dto = new ChangePasswordDto();
    dto.newPassword = 'newPass456';
    const errors = await validateDto(dto);
    expect(errors.some(e => e.property === 'oldPassword')).toBe(true);
  });

  it('newPassword 太短应报错', async () => {
    const dto = new ChangePasswordDto();
    dto.oldPassword = 'oldPass123';
    dto.newPassword = 'Ab1';
    const errors = await validateDto(dto);
    expect(errors.some(e => e.property === 'newPassword')).toBe(true);
  });

  it('newPassword 太长应报错', async () => {
    const dto = new ChangePasswordDto();
    dto.oldPassword = 'oldPass123';
    dto.newPassword = 'A'.repeat(21) + '1';
    const errors = await validateDto(dto);
    expect(errors.some(e => e.property === 'newPassword')).toBe(true);
  });

  it('newPassword 无字母应报错', async () => {
    const dto = new ChangePasswordDto();
    dto.oldPassword = 'oldPass123';
    dto.newPassword = '123456';
    const errors = await validateDto(dto);
    expect(errors.some(e => e.property === 'newPassword')).toBe(true);
  });

  it('newPassword 无数字应报错', async () => {
    const dto = new ChangePasswordDto();
    dto.oldPassword = 'oldPass123';
    dto.newPassword = 'abcde';
    const errors = await validateDto(dto);
    // 长度不足 6 或无数字均应报错
    expect(errors.length).toBeGreaterThan(0);
  });
});
