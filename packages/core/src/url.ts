/**
 * Turns a host as supplied by a hosting platform into a public HTTPS base URL.
 * Render's Blueprint `fromService … property: host` yields the service's short private-network
 * name (e.g. `crave-api-ab12`), which browsers can't reach; its public address is that name plus
 * `.onrender.com`. Full URLs and dotted hosts are kept as given.
 */
export function publicBaseUrl(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith('localhost') || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(s)) return `http://${s}`;
  return `https://${s.includes('.') ? s : `${s}.onrender.com`}`;
}
