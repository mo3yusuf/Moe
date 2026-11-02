/**
 * Gesture classification for the CRAVE Smart Swipe system.
 *
 * - Horizontal right  → CRAVE IT   (strong positive, saves to Cravings)
 * - Horizontal left   → NOT FOR ME (negative, hides this exact video)
 * - Vertical up       → next video (handled by the pager; watch time decides the signal)
 * - Vertical down     → previous video (never recorded as a new preference)
 *
 * Thresholds deliberately require clear intent: a horizontal swipe must travel a
 * meaningful distance (or be a fast flick) AND be clearly more horizontal than
 * vertical, so normal vertical scrolling never triggers a preference.
 */

export type SwipeDecision = 'crave' | 'not_for_me' | 'none';

export interface SwipeThresholds {
  /** Fraction of screen width the finger must travel to commit. */
  distanceRatio: number;
  /** Velocity (px/s) that commits a shorter flick. */
  flickVelocity: number;
  /** Minimum distance (px) even for a flick, to ignore taps/jitter. */
  minFlickDistance: number;
  /** |dx| must exceed |dy| * dominance to count as horizontal. */
  dominance: number;
}

export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = {
  distanceRatio: 0.32,
  flickVelocity: 900,
  minFlickDistance: 48,
  dominance: 1.6,
};

export interface SwipeGesture {
  translationX: number;
  translationY: number;
  velocityX: number;
  screenWidth: number;
}

export function classifyHorizontalSwipe(g: SwipeGesture, t: SwipeThresholds = DEFAULT_SWIPE_THRESHOLDS): SwipeDecision {
  const absX = Math.abs(g.translationX);
  const absY = Math.abs(g.translationY);
  if (absX < absY * t.dominance) return 'none';

  const pastDistance = absX >= g.screenWidth * t.distanceRatio;
  const fastFlick =
    absX >= t.minFlickDistance && Math.abs(g.velocityX) >= t.flickVelocity && Math.sign(g.velocityX) === Math.sign(g.translationX);

  if (!pastDistance && !fastFlick) return 'none';
  return g.translationX > 0 ? 'crave' : 'not_for_me';
}

/** 0..1 progress used to drive the on-screen CRAVE IT / NOT FOR ME stamp. */
export function swipeProgress(translationX: number, screenWidth: number, t: SwipeThresholds = DEFAULT_SWIPE_THRESHOLDS): number {
  const p = Math.abs(translationX) / (screenWidth * t.distanceRatio);
  return Math.max(0, Math.min(1, p));
}

// ---------------------------------------------------------------------------
// Watch signals (vertical navigation)
// ---------------------------------------------------------------------------

export type WatchSignal = 'quick_skip' | 'partial_view' | 'long_view' | 'completed_view';

export interface WatchThresholds {
  /** Leaving before this many ms is a quick skip (weak negative). */
  quickSkipMs: number;
  /** Watching at least this fraction is a long view (weak positive). */
  longViewRatio: number;
  /** Completion fraction counted as a full view. */
  completedRatio: number;
}

export const DEFAULT_WATCH_THRESHOLDS: WatchThresholds = {
  quickSkipMs: 1500,
  longViewRatio: 0.6,
  completedRatio: 0.95,
};

export interface WatchSession {
  watchedMs: number;
  durationMs: number;
  /** Number of times the video looped while on screen. */
  loops: number;
}

export function completionRatio(s: WatchSession): number {
  if (s.durationMs <= 0) return 0;
  return Math.min(1, s.watchedMs / s.durationMs + s.loops);
}

export function classifyWatch(s: WatchSession, t: WatchThresholds = DEFAULT_WATCH_THRESHOLDS): WatchSignal {
  if (s.loops > 0) return 'completed_view';
  const ratio = completionRatio(s);
  if (ratio >= t.completedRatio) return 'completed_view';
  if (s.watchedMs < t.quickSkipMs) return 'quick_skip';
  if (ratio >= t.longViewRatio) return 'long_view';
  return 'partial_view';
}

/**
 * Tracks which feed positions have already produced a watch signal in the
 * current session, so swiping back down to a previous video (and then up again)
 * does not record duplicate preference signals.
 */
export class FeedSessionTracker {
  private readonly recorded = new Set<string>();

  /** Returns true the first time a video is resolved in this session. */
  shouldRecord(videoId: string): boolean {
    if (this.recorded.has(videoId)) return false;
    this.recorded.add(videoId);
    return true;
  }

  hasRecorded(videoId: string): boolean {
    return this.recorded.has(videoId);
  }

  reset(): void {
    this.recorded.clear();
  }
}
