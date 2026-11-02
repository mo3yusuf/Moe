import { supabaseServer } from '@/lib/supabase/server';

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q ?? '';
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('admin_find_users', { p_query: q, p_limit: 100 });
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Customers</h1>
      <form className="row"><input name="q" defaultValue={q} placeholder="Search email, name or user id" style={{ flex: 1 }} /><button className="btn secondary">Search</button></form>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Access to personal information is logged by Supabase. Only look up customers for a support, safety or legal reason.</p>
      {error ? <p className="error">{error.message}</p> : (
        <table><thead><tr><th>Email</th><th>Name</th><th>Roles</th><th>Orders</th><th>Refunds</th><th>Flags</th><th>Joined</th></tr></thead><tbody>
          {(data ?? []).map((u: any) => (
            <tr key={u.id}><td>{u.email}{u.deletion_requested_at ? <span className="badge bad" style={{ marginLeft: 6 }}>deletion requested</span> : null}</td>
              <td>{u.display_name}</td><td>{u.roles.join(', ')}</td><td>{u.orders}</td><td>{u.refunds}</td>
              <td>{u.open_flags ? <span className="badge bad">{u.open_flags}</span> : 0}</td><td>{new Date(u.created_at).toLocaleDateString('en-AU')}</td></tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}
