import { normalizeAuthPhone, normalizeNationalPhone } from './phone.util';

describe('phone.util', () => {
  describe('normalizeNationalPhone (India +91)', () => {
    it('keeps a valid 10-digit mobile', () => {
      expect(normalizeNationalPhone('+91', '9611299129')).toBe('9611299129');
      expect(normalizeNationalPhone('91', '9611299129')).toBe('9611299129');
    });

    it('strips spaces', () => {
      expect(normalizeNationalPhone('+91', '096112 99129')).toBe('9611299129');
      expect(normalizeNationalPhone('+91', '96112 99129')).toBe('9611299129');
    });

    it('drops a leading trunk 0', () => {
      expect(normalizeNationalPhone('+91', '09611299129')).toBe('9611299129');
    });

    it('strips a pasted country-code prefix', () => {
      expect(normalizeNationalPhone('+91', '919611299129')).toBe('9611299129');
      expect(normalizeNationalPhone('+91', '+91 96112 99129')).toBe(
        '9611299129',
      );
    });
  });

  describe('normalizeAuthPhone', () => {
    it('builds +91 canonical form from messy input', () => {
      expect(normalizeAuthPhone('+91', '096112 99129')).toBe('+919611299129');
      expect(normalizeAuthPhone('91', '9611299129')).toBe('+919611299129');
    });
  });
});
