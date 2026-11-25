'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Section tabs for a restaurant: highlights where you are, scrolls sideways on a phone. */
export function NavTabs({ base, showSetup, newOrders }: { base: string; showSetup: boolean; newOrders: number }) {
  const path = usePathname();
  const tabs: [string, string][] = [
    ...(showSetup ? [['/setup', 'Finish setup'] as [string, string]] : []),
    ['', 'Home'], ['/orders', 'Orders'], ['/menu', 'Menu'], ['/hours', 'Hours'], ['/content', 'Videos'],
    ['/sales', 'Sales'], ['/payouts', 'Payouts'], ['/verification', 'Verification'], ['/support', 'Help'],
  ];
  return (
    <nav className="tabs" aria-label="Restaurant sections">
      {tabs.map(([p, label]) => {
        const href = `${base}${p}`;
        const active = p === '' ? path === base : path.startsWith(href);
        return (
          <Link key={p} href={href} className={`tab ${active ? 'active' : ''} ${p === '/setup' ? 'tab-setup' : ''}`} aria-current={active ? 'page' : undefined}>
            {label}
            {p === '/orders' && newOrders > 0 ? <span className="tab-count" aria-label={`${newOrders} new`}>{newOrders}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
