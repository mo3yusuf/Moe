import { EventBuffer, WatchSession, type FeedEvent, type SwipeEvent } from '@crave/core';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { api } from '@/lib/api';
import { config } from '@/lib/config';

export type ActionEvent = { kind: 'action'; action: 'like' | 'unlike' | 'save' | 'unsave'; videoId: string; menuItemId?: string | null };
export type ClickEvent = { kind: 'interaction'; eventType: 'share' | 'menu_item_click' | 'order_click' | 'add_to_basket' | 'restaurant_click'; videoId: string; menuItemId?: string | null; feedRequestId?: string | null };
export type ClientEvent = FeedEvent | SwipeEvent | ActionEvent | ClickEvent;

/** One watch session per app launch: governs impressions, skips, replays and swipe de-duplication. */
export const watchSession = new WatchSession();

export const eventBuffer = new EventBuffer<ClientEvent>({
  newId: () => Crypto.randomUUID(),
  maxBatch: 50,
  async send(batch) {
    if (config.demoMode) return; // demo mode: events are discarded, never sent anywhere
    await api('/v1/events', { body: { events: batch } });
  },
});

export function track(...events: (ClientEvent | null | undefined)[]) {
  for (const e of events) if (e) eventBuffer.push(e);
  if (eventBuffer.size >= 20) void eventBuffer.flush();
}

// Flush periodically and whenever the app goes to the background.
setInterval(() => { if (eventBuffer.size) void eventBuffer.flush(); }, 8000);
AppState.addEventListener('change', (s) => { if (s !== 'active') void eventBuffer.flush(); });
