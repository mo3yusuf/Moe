'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Refreshes the order queue every 15 s while the tab is visible. Realtime push is a later upgrade. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
