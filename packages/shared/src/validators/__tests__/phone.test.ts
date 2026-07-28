import { describe, it, expect } from 'vitest';
import { isPhoneNumber, normalizePhone } from '../phone';

describe('phone validator', () => {
  describe('isPhoneNumber', () => {
    it('should return true for valid Chinese phone numbers', () => {
      expect(isPhoneNumber('13800138000')).toBe(true);
      expect(isPhoneNumber('13912345678')).toBe(true);
      expect(isPhoneNumber('15012345678')).toBe(true);
      expect(isPhoneNumber('18812345678')).toBe(true);
    });

    it('should return false for invalid phone numbers', () => {
      expect(isPhoneNumber('12345678901')).toBe(false); // starts with 12
      expect(isPhoneNumber('1380013800')).toBe(false); // 10 digits
      expect(isPhoneNumber('138001380001')).toBe(false); // 12 digits
      expect(isPhoneNumber('23800138000')).toBe(false); // starts with 2
      expect(isPhoneNumber('1380013800a')).toBe(false); // contains letter
    });

    it('should return false for null/undefined/empty', () => {
      expect(isPhoneNumber(null)).toBe(false);
      expect(isPhoneNumber(undefined)).toBe(false);
      expect(isPhoneNumber('')).toBe(false);
    });

    it('should coerce numbers to string for regex test', () => {
      // isPhoneNumber uses regex which coerces to string
      expect(isPhoneNumber(13800138000 as unknown as string)).toBe(true);
    });
  });

  describe('normalizePhone', () => {
    it('should remove spaces and dashes', () => {
      expect(normalizePhone('138 0013 8000')).toBe('13800138000');
      expect(normalizePhone('138-0013-8000')).toBe('13800138000');
      expect(normalizePhone('138 0013-8000')).toBe('13800138000');
    });

    it('should remove +86 prefix', () => {
      expect(normalizePhone('+8613800138000')).toBe('13800138000');
      expect(normalizePhone('+86 138-0013-8000')).toBe('13800138000');
    });

    it('should remove 86 prefix when 13 digits', () => {
      expect(normalizePhone('8613800138000')).toBe('13800138000');
    });

    it('should not remove 86 prefix when not 13 digits', () => {
      expect(normalizePhone('861380013')).toBe('861380013');
    });

    it('should return null for null/undefined/empty', () => {
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone(undefined)).toBeNull();
      expect(normalizePhone('')).toBeNull();
    });

    it('should return original string if no formatting needed', () => {
      expect(normalizePhone('13800138000')).toBe('13800138000');
    });
  });
});
