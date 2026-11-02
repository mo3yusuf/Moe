import { describe, expect, it } from 'vitest';
import {
  AuAddressSchema,
  FeedSessionTracker,
  VideoUploadSchema,
  classifyHorizontalSwipe,
  classifyWatch,
  extractHashtags,
  formatAuAddress,
  isValidAbn,
} from '../src';

const W = 400;

describe('horizontal swipe classification', () => {
  it('commits a right swipe past the distance threshold', () => {
    expect(classifyHorizontalSwipe({ translationX: 140, translationY: 10, velocityX: 100, screenWidth: W })).toBe('crave');
  });
  it('commits a left flick', () => {
    expect(classifyHorizontalSwipe({ translationX: -60, translationY: 5, velocityX: -1500, screenWidth: W })).toBe('not_for_me');
  });
  it('ignores short drags, taps and diagonal movement', () => {
    expect(classifyHorizontalSwipe({ translationX: 60, translationY: 0, velocityX: 200, screenWidth: W })).toBe('none');
    expect(classifyHorizontalSwipe({ translationX: 20, translationY: 0, velocityX: 3000, screenWidth: W })).toBe('none');
    expect(classifyHorizontalSwipe({ translationX: 150, translationY: 120, velocityX: 1500, screenWidth: W })).toBe('none');
  });
  it('ignores a flick whose velocity opposes the drag direction', () => {
    expect(classifyHorizontalSwipe({ translationX: 60, translationY: 0, velocityX: -1500, screenWidth: W })).toBe('none');
  });
});

describe('watch signals', () => {
  it('treats a brief skip as a weak signal, not a dislike', () => {
    expect(classifyWatch({ watchedMs: 800, durationMs: 15000, loops: 0 })).toBe('quick_skip');
    expect(classifyWatch({ watchedMs: 5000, durationMs: 15000, loops: 0 })).toBe('partial_view');
    expect(classifyWatch({ watchedMs: 10000, durationMs: 15000, loops: 0 })).toBe('long_view');
    expect(classifyWatch({ watchedMs: 14500, durationMs: 15000, loops: 0 })).toBe('completed_view');
    expect(classifyWatch({ watchedMs: 2000, durationMs: 15000, loops: 1 })).toBe('completed_view');
  });

  it('does not record a second signal when navigating back to a video', () => {
    const t = new FeedSessionTracker();
    expect(t.shouldRecord('v1')).toBe(true);
    expect(t.shouldRecord('v2')).toBe(true);
    expect(t.shouldRecord('v1')).toBe(false); // swiped down then up again
  });
});

describe('Australian validation', () => {
  it('validates and formats addresses', () => {
    const a = AuAddressSchema.parse({ unit: '2', streetLine: '15 Example St', suburb: 'Fortitude Valley', state: 'QLD', postcode: '4006' });
    expect(formatAuAddress(a)).toBe('2/15 Example St, Fortitude Valley QLD 4006');
    expect(AuAddressSchema.safeParse({ streetLine: '1 George St', suburb: 'Brisbane City', state: 'QLD', postcode: '2000' }).success).toBe(false);
    expect(AuAddressSchema.safeParse({ streetLine: '1 George St', suburb: 'Brisbane City', state: 'QLD', postcode: '400' }).success).toBe(false);
  });

  it('validates ABN checksums', () => {
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('51 824 753 557')).toBe(false);
    expect(isValidAbn('123')).toBe(false);
  });
});

describe('video upload validation', () => {
  const base = { mimeType: 'video/mp4', sizeBytes: 10_000_000, durationMs: 20_000, rightsConfirmed: true } as const;
  it('accepts a valid upload', () => {
    expect(VideoUploadSchema.safeParse(base).success).toBe(true);
  });
  it('enforces size, duration, type, rights and sponsorship disclosure', () => {
    expect(VideoUploadSchema.safeParse({ ...base, sizeBytes: 300 * 1024 * 1024 }).success).toBe(false);
    expect(VideoUploadSchema.safeParse({ ...base, durationMs: 1000 }).success).toBe(false);
    expect(VideoUploadSchema.safeParse({ ...base, durationMs: 400_000 }).success).toBe(false);
    expect(VideoUploadSchema.safeParse({ ...base, mimeType: 'video/x-msvideo' }).success).toBe(false);
    expect(VideoUploadSchema.safeParse({ ...base, rightsConfirmed: false }).success).toBe(false);
    expect(VideoUploadSchema.safeParse({ ...base, isSponsored: true }).success).toBe(false);
    expect(VideoUploadSchema.safeParse({ ...base, isSponsored: true, sponsorDisclosure: 'Paid partnership with Demo Burger Co' }).success).toBe(true);
  });
  it('extracts unique hashtags', () => {
    expect(extractHashtags('Best #Burger in #Brisbane #burger')).toEqual(['burger', 'brisbane']);
  });
});
