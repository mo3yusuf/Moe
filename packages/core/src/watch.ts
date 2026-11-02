/**
 * Tracks viewing of feed videos and turns it into recommendation events.
 *
 * Rules (from the product spec):
 *  - First time a video becomes active in a session: one `impression`.
 *  - Leaving a video: one `watch` event with watch time and completion %. A quick skip is a WEAK
 *    negative signal that the ranking engine weighs lightly — it is never treated as a dislike.
 *  - Navigating back to a video already seen this session does not create a new impression or
 *    a new skip signal. Watching it to the end again counts as a `replay` (genuine re-engagement).
 *  - Explicit swipes are de-duplicated: repeating the same swipe on the same video is ignored; a
 *    changed mind (left after right) is recorded and the latest wins downstream.
 */
import type { SwipeDirection } from './swipe';

export type FeedEventType = 'impression' | 'watch' | 'replay';

export interface FeedEvent {
  kind: 'interaction';
  eventType: FeedEventType;
  videoId: string;
  menuItemId?: string | null;
  watchMs?: number;
  completionPct?: number;
  feedRequestId?: string | null;
}

export interface SwipeEvent {
  kind: 'swipe';
  videoId: string;
  menuItemId?: string | null;
  direction: SwipeDirection;
  inputMethod: 'gesture' | 'button' | 'accessibility_action';
  feedRequestId?: string | null;
}

interface ViewState {
  firstSeenAt: number;
  activeSince: number | null;
  watchedMsThisVisit: number;
  maxPositionMs: number;
  loopsThisVisit: number;
  completedEver: boolean;
  visits: number;
  lastSwipe: SwipeDirection | null;
}

export class WatchSession {
  private views = new Map<string, ViewState>();
  private active: string | null = null;

  constructor(private now: () => number = () => Date.now()) {}

  /** Call when a video becomes the visible, playing item. Returns events to record. */
  activate(videoId: string, meta: Pick<FeedEvent, 'menuItemId' | 'feedRequestId'> = {}): FeedEvent[] {
    const events: FeedEvent[] = [];
    if (this.active && this.active !== videoId) events.push(...this.deactivate(this.active, 0, meta));
    let v = this.views.get(videoId);
    if (!v) {
      v = { firstSeenAt: this.now(), activeSince: null, watchedMsThisVisit: 0, maxPositionMs: 0, loopsThisVisit: 0, completedEver: false, visits: 0, lastSwipe: null };
      this.views.set(videoId, v);
      events.push({ kind: 'interaction', eventType: 'impression', videoId, ...meta });
    }
    if (v.activeSince === null) {
      v.visits += 1;
      v.activeSince = this.now();
      v.watchedMsThisVisit = 0;
      v.maxPositionMs = 0;
      v.loopsThisVisit = 0;
    }
    this.active = videoId;
    return events;
  }

  /** Playback progress from the player (position within the clip). */
  progress(videoId: string, positionMs: number): void {
    const v = this.views.get(videoId);
    if (!v || v.activeSince === null) return;
    v.maxPositionMs = Math.max(v.maxPositionMs, positionMs);
  }

  /** The clip reached its end and looped. */
  looped(videoId: string): void {
    const v = this.views.get(videoId);
    if (v && v.activeSince !== null) v.loopsThisVisit += 1;
  }

  /** Call when the video stops being active (scrolled away, app backgrounded, tab change). */
  deactivate(videoId: string, durationMs: number, meta: Pick<FeedEvent, 'menuItemId' | 'feedRequestId'> = {}): FeedEvent[] {
    const v = this.views.get(videoId);
    if (!v || v.activeSince === null) return [];
    const watchMs = Math.max(0, this.now() - v.activeSince);
    v.activeSince = null;
    if (this.active === videoId) this.active = null;

    const completed = v.loopsThisVisit > 0 || (durationMs > 0 && v.maxPositionMs >= durationMs * 0.95);
    const completionPct = v.loopsThisVisit > 0 ? 100
      : durationMs > 0 ? Math.min(100, Math.round((v.maxPositionMs / durationMs) * 100)) : 0;

    const events: FeedEvent[] = [];
    if (v.visits === 1) {
      events.push({ kind: 'interaction', eventType: 'watch', videoId, watchMs: Math.min(watchMs, 3_600_000), completionPct, ...meta });
      if (v.loopsThisVisit > 0) events.push({ kind: 'interaction', eventType: 'replay', videoId, ...meta });
    } else if (completed) {
      // Revisit: only genuine re-watching counts; passing through is not a new signal.
      events.push({ kind: 'interaction', eventType: 'replay', videoId, ...meta });
    }
    if (completed) v.completedEver = true;
    return events;
  }

  /** Returns a swipe event, or null when it duplicates the previous swipe on this video. */
  swipe(videoId: string, direction: SwipeDirection, inputMethod: SwipeEvent['inputMethod'], meta: Pick<SwipeEvent, 'menuItemId' | 'feedRequestId'> = {}): SwipeEvent | null {
    let v = this.views.get(videoId);
    if (!v) {
      v = { firstSeenAt: this.now(), activeSince: null, watchedMsThisVisit: 0, maxPositionMs: 0, loopsThisVisit: 0, completedEver: false, visits: 0, lastSwipe: null };
      this.views.set(videoId, v);
    }
    if (v.lastSwipe === direction) return null;
    v.lastSwipe = direction;
    return { kind: 'swipe', videoId, direction, inputMethod, ...meta };
  }

  lastSwipe(videoId: string): SwipeDirection | null {
    return this.views.get(videoId)?.lastSwipe ?? null;
  }

  hasSeen(videoId: string): boolean {
    return this.views.has(videoId);
  }
}
