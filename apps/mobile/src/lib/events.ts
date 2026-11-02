import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { api } from './api';
import { supabase } from './supabase';

export type EventType =
  | 'impression' | 'watch' | 'crave_swipe' | 'not_for_me_swipe' | 'like' | 'unlike' | 'save_meal' | 'unsave_meal'
  | 'share' | 'comment' | 'menu_item_click' | 'add_to_basket' | 'search' | 'follow_restaurant' | 'follow_creator';

export interface TrackedEvent {
  clientEventId: string;
  type: EventType;
  occurredAt: string;
  videoId?: string;
  menuItemId?: string;
  restaurantId?: string;
  watchedMs?: number;
  durationMs?: number;
  loops?: number;
  feedSessionId?: string;
  position?: number;
  query?: string;
}

/**
 * Batches interaction events and sends them to the CRAVE API. Each event has a
 * client-generated id so retries never double count. Signed-out users' events
 * are dropped (nothing is learned without an account).
 */
class EventQueue {
  private queue: TrackedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor() {
    AppState.addEventListener('change', (s) => {
      if (s !== 'active') void this.flush();
    });
  }

  track(type: EventType, data: Omit<TrackedEvent, 'clientEventId' | 'type' | 'occurredAt'> = {}): void {
    this.queue.push({ clientEventId: Crypto.randomUUID(), type, occurredAt: new Date().toISOString(), ...data });
    // Explicit actions flush quickly so likes/saves persist; passive signals batch.
    const urgent = type !== 'watch' && type !== 'impression';
    if (this.queue.length >= 20 || urgent) this.schedule(urgent ? 300 : 0);
    else this.schedule(5000);
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    if (!session) {
      this.queue = [];
      return;
    }
    this.flushing = true;
    const batch = this.queue.splice(0, 100);
    try {
      await api('/v1/events', { method: 'POST', body: { events: batch } });
    } catch {
      // Put them back (bounded) and retry later. Server dedupes by clientEventId.
      this.queue = [...batch, ...this.queue].slice(0, 500);
      this.schedule(15000);
    } finally {
      this.flushing = false;
    }
  }
}

export const events = new EventQueue();
export const newId = () => Crypto.randomUUID();
