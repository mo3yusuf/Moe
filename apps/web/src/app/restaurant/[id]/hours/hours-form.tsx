'use client';
import { useActionState } from 'react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function HoursForm({ action, hours }: {
  action: (p: { error?: string; ok?: string } | undefined, f: FormData) => Promise<{ error?: string; ok?: string }>;
  hours: { day_of_week: number; opens_at: string; closes_at: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="stack">
      <table><thead><tr><th>Day</th><th>Opens</th><th>Closes</th><th>Closed</th></tr></thead><tbody>
        {DAYS.map((name, d) => {
          const h = hours.find((x) => x.day_of_week === d);
          return (
            <tr key={d}>
              <td>{name}</td>
              <td><input type="time" name={`opens-${d}`} defaultValue={h?.opens_at.slice(0, 5) ?? '11:00'} /></td>
              <td><input type="time" name={`closes-${d}`} defaultValue={h?.closes_at.slice(0, 5) ?? '21:00'} /></td>
              <td><input type="checkbox" name={`closed-${d}`} defaultChecked={!h} style={{ width: 20, minHeight: 20 }} aria-label={`Closed on ${name}`} /></td>
            </tr>
          );
        })}
      </tbody></table>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Times are Brisbane time. A closing time earlier than opening (e.g. 18:00–02:00) runs past midnight.</p>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      {state?.ok ? <p style={{ color: 'var(--success)' }}>{state.ok}</p> : null}
      <div><button className="btn" disabled={pending}>Save hours</button></div>
    </form>
  );
}
