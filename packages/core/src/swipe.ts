/**
 * Smart Swipe gesture rules. Pure functions so the same thresholds are unit-tested and used on device.
 *
 * Horizontal swipes are explicit preference signals, so they need deliberate intent:
 *  - mostly horizontal (|dx| clearly larger than |dy|), and
 *  - far enough (distance threshold) OR a fast flick that has still travelled a minimum distance.
 * Anything else springs back with no signal recorded.
 */
export type SwipeDirection = 'right' | 'left';

export interface SwipeThresholds {
  /** Fraction of screen width that commits a swipe without velocity. */
  distanceRatio: number;
  /** Minimum fraction of width for a fast flick to count. */
  flickMinRatio: number;
  /** Velocity (points/sec) that qualifies as a flick. */
  flickVelocity: number;
  /** |dx| must exceed |dy| * this factor. */
  horizontalDominance: number;
}

export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = {
  distanceRatio: 0.3,
  flickMinRatio: 0.12,
  flickVelocity: 900,
  horizontalDominance: 1.6,
};

/** Gesture-handler activation: start tracking horizontal pan only after 24pt, give up after 16pt vertical. */
export const PAN_ACTIVATION = { activeOffsetX: [-24, 24] as [number, number], failOffsetY: [-16, 16] as [number, number] };

export interface SwipeInput {
  dx: number;
  dy: number;
  vx: number;
  width: number;
}

export function classifySwipe(input: SwipeInput, t: SwipeThresholds = DEFAULT_SWIPE_THRESHOLDS): SwipeDirection | null {
  'worklet';
  const { dx, dy, vx, width } = input;
  if (width <= 0) return null;
  const adx = Math.abs(dx);
  if (adx < Math.abs(dy) * t.horizontalDominance) return null;
  const far = adx >= width * t.distanceRatio;
  const flick = Math.abs(vx) >= t.flickVelocity && adx >= width * t.flickMinRatio && Math.sign(vx) === Math.sign(dx);
  if (!far && !flick) return null;
  return dx > 0 ? 'right' : 'left';
}

/** 0..1 progress used to fade in the CRAVE IT / NOT FOR ME overlay while dragging. */
export function swipeProgress(dx: number, width: number, t: SwipeThresholds = DEFAULT_SWIPE_THRESHOLDS): number {
  'worklet';
  if (width <= 0) return 0;
  return Math.min(1, Math.abs(dx) / (width * t.distanceRatio));
}

export const SWIPE_LABELS: Record<SwipeDirection, string> = { right: 'CRAVE IT', left: 'NOT FOR ME' };
