import { describe, expect, it } from 'vitest';
import { WatchSession } from '../src/watch';

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('WatchSession', () => {
  it('emits one impression and a watch event with completion', () => {
    const c = clock();
    const s = new WatchSession(c.now);
    expect(s.activate('v1').map((e) => e.eventType)).toEqual(['impression']);
    c.advance(6000);
    s.progress('v1', 6000);
    const out = s.deactivate('v1', 15000);
    expect(out).toEqual([{ kind: 'interaction', eventType: 'watch', videoId: 'v1', watchMs: 6000, completionPct: 40 }]);
  });

  it('records a quick skip as a short watch (weak signal), not a dislike', () => {
    const c = clock();
    const s = new WatchSession(c.now);
    s.activate('v1');
    c.advance(800);
    s.progress('v1', 800);
    const [watch] = s.deactivate('v1', 15000);
    expect(watch).toMatchObject({ eventType: 'watch', watchMs: 800, completionPct: 5 });
    expect(s.lastSwipe('v1')).toBeNull();
  });

  it('activating the next video closes the previous one', () => {
    const c = clock();
    const s = new WatchSession(c.now);
    s.activate('v1');
    c.advance(2000);
    const events = s.activate('v2');
    expect(events.map((e) => `${e.eventType}:${e.videoId}`)).toEqual(['watch:v1', 'impression:v2']);
  });

  it('navigating back to a seen video creates no new impression or skip signal', () => {
    const c = clock();
    const s = new WatchSession(c.now);
    s.activate('v1'); c.advance(3000); s.activate('v2'); c.advance(1000);
    const back = s.activate('v1');
    expect(back.map((e) => `${e.eventType}:${e.videoId}`)).toEqual(['watch:v2']); // no impression for v1
    c.advance(500);
    expect(s.deactivate('v1', 15000)).toEqual([]); // brief revisit: nothing
  });

  it('re-watching a revisited video to the end counts as a replay', () => {
    const c = clock();
    const s = new WatchSession(c.now);
    s.activate('v1'); s.activate('v2'); s.activate('v1');
    s.progress('v1', 14800);
    expect(s.deactivate('v1', 15000).map((e) => e.eventType)).toEqual(['replay']);
  });

  it('looping on first view records watch at 100% plus a replay', () => {
    const c = clock();
    const s = new WatchSession(c.now);
    s.activate('v1'); c.advance(31000); s.looped('v1');
    const out = s.deactivate('v1', 15000);
    expect(out.map((e) => e.eventType)).toEqual(['watch', 'replay']);
    expect(out[0]).toMatchObject({ completionPct: 100 });
  });

  it('de-duplicates repeated swipes but records a change of mind', () => {
    const s = new WatchSession();
    expect(s.swipe('v1', 'right', 'gesture')).not.toBeNull();
    expect(s.swipe('v1', 'right', 'button')).toBeNull();
    expect(s.swipe('v1', 'left', 'gesture')).toMatchObject({ direction: 'left' });
  });
});
