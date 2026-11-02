'use client';
import { useEffect, useRef } from 'react';

/** Plays both plain MP4/MOV files and Mux HLS streams (.m3u8). Safari plays HLS natively; other browsers use hls.js. */
export function VideoPreview({ src, poster }: { src: string; poster?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!src.includes('.m3u8') || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return;
    }
    let hls: { destroy(): void } | null = null;
    let cancelled = false;
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) { if (!cancelled) video.src = src; return; }
      const h = new Hls();
      h.loadSource(src);
      h.attachMedia(video);
      hls = h;
    });
    return () => { cancelled = true; hls?.destroy(); };
  }, [src]);
  return <video ref={ref} poster={poster ?? undefined} controls muted playsInline style={{ width: '100%', aspectRatio: '9/16', background: '#000', borderRadius: 8 }} />;
}
