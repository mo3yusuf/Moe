import { describe, expect, it } from 'vitest';
import { BRISBANE_SUBURBS, formatAbn, isValidAbn, isValidAuPhone, slugify } from '../src/business';

describe('ABN', () => {
  it('accepts valid ABNs (ATO published example) with or without spaces', () => {
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('51824753556')).toBe(true);
  });
  it('rejects bad checksums and wrong lengths', () => {
    expect(isValidAbn('51 824 753 557')).toBe(false);
    expect(isValidAbn('1234567890')).toBe(false);
    expect(isValidAbn('abcdefghijk')).toBe(false);
  });
  it('formats', () => expect(formatAbn('51824753556')).toBe('51 824 753 556'));
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Café Déjà Vu & Co.')).toBe('cafe-deja-vu-and-co');
    expect(slugify('   ')).toBe('restaurant');
  });
});

describe('AU phone', () => {
  it('validates landlines and mobiles', () => {
    expect(isValidAuPhone('07 3123 4567')).toBe(true);
    expect(isValidAuPhone('+61 412 345 678')).toBe(true);
    expect(isValidAuPhone('12345')).toBe(false);
  });
});

describe('Brisbane suburbs', () => {
  it('all centroids are within greater Brisbane', () => {
    for (const s of Object.values(BRISBANE_SUBURBS)) {
      expect(s.lat).toBeGreaterThan(-27.7); expect(s.lat).toBeLessThan(-27.3);
      expect(s.lng).toBeGreaterThan(152.9); expect(s.lng).toBeLessThan(153.2);
      expect(s.postcode).toMatch(/^4\d{3}$/);
    }
  });
});
