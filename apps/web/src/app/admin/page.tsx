import { supabaseServer } from '@/lib/supabase/server';

export default async function AdminHome() {
  const supabase = await supabaseServer();
  const count = async (table: string, filter?: [string, string]) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    return (await q).count ?? 0;
  };
  const [pending, restaurants, videos, reports] = await Promise.all([
    count('restaurant_verifications', ['status', 'submitted']),
    count('restaurants'),
    count('videos', ['status', 'pending_review']),
    count('content_reports', ['status', 'open']),
  ]);
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Admin overview</h1>
      <div className="grid">
        <Stat label="Verifications awaiting review" value={pending} />
        <Stat label="Restaurants" value={restaurants} />
        <Stat label="Videos awaiting moderation" value={videos} />
        <Stat label="Open content reports" value={reports} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="card"><div className="muted">{label}</div><div style={{ fontSize: 32, fontWeight: 800 }}>{value}</div></div>;
}
