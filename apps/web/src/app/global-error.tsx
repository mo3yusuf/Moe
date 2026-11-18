'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Last-resort error screen; also reports the crash to Sentry (when configured).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="en-AU">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 40, textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <p>We&apos;ve been notified and are looking into it.</p>
        <button type="button" onClick={() => reset()} style={{ marginTop: 16, padding: '10px 18px' }}>Try again</button>
      </body>
    </html>
  );
}
