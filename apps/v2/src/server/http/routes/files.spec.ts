import { describe, expect, it } from 'vitest';
import { validFileMagic } from './files';

describe('file magic validation', () => {
  it('rejects unknown extensions and accepts allowed signatures', () => {
    expect(validFileMagic('', Buffer.from('x'))).toBe(false);
    expect(validFileMagic('.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(validFileMagic('.jpg', Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(validFileMagic('.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe(true);
    expect(validFileMagic('.pdf', Buffer.from('%PDF'))).toBe(true);
  });
});
