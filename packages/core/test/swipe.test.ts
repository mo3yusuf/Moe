import { describe, expect, it } from 'vitest';
import { classifySwipe, swipeProgress } from '../src/swipe';

const W = 400;
describe('classifySwipe', () => {
  it('commits a deliberate right swipe past the distance threshold', () => {
    expect(classifySwipe({ dx: 130, dy: 10, vx: 100, width: W })).toBe('right');
  });
  it('commits a deliberate left swipe', () => {
    expect(classifySwipe({ dx: -150, dy: -20, vx: -50, width: W })).toBe('left');
  });
  it('ignores short drags (accidental touches)', () => {
    expect(classifySwipe({ dx: 60, dy: 0, vx: 200, width: W })).toBeNull();
  });
  it('accepts a fast flick that travelled a minimum distance', () => {
    expect(classifySwipe({ dx: 55, dy: 5, vx: 1400, width: W })).toBe('right');
  });
  it('rejects a fast flick that barely moved', () => {
    expect(classifySwipe({ dx: 20, dy: 0, vx: 2000, width: W })).toBeNull();
  });
  it('rejects a flick whose velocity opposes the drag (finger reversed)', () => {
    expect(classifySwipe({ dx: 60, dy: 0, vx: -1500, width: W })).toBeNull();
  });
  it('rejects diagonal / mostly vertical movement so vertical scrolling is never a preference', () => {
    expect(classifySwipe({ dx: 140, dy: 120, vx: 300, width: W })).toBeNull();
    expect(classifySwipe({ dx: 30, dy: 300, vx: 0, width: W })).toBeNull();
  });
  it('progress is clamped 0..1', () => {
    expect(swipeProgress(0, W)).toBe(0);
    expect(swipeProgress(60, W)).toBeCloseTo(0.5);
    expect(swipeProgress(-1000, W)).toBe(1);
  });
});
