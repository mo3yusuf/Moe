'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { submitVerification } from './actions';

export function VerificationForm({ restaurantId }: { restaurantId: string }) {
  const [licence, setLicence] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const supabase = supabaseBrowser();
    const paths: string[] = [];
    for (const f of files) {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type) || f.size > 20 * 1024 * 1024) {
        setBusy(false); return setStatus(`${f.name}: use PDF/JPG/PNG under 20 MB.`);
      }
      setStatus(`Uploading ${f.name}…`);
      const path = `${restaurantId}/${Date.now()}-${f.name.replace(/[^\w.-]/g, '_')}`;
      const { error } = await supabase.storage.from('verification-docs').upload(path, f, { contentType: f.type });
      if (error) { setBusy(false); return setStatus(`Upload failed: ${error.message}`); }
      paths.push(path);
    }
    const res = await submitVerification(restaurantId, licence, paths);
    setBusy(false);
    setStatus(res.error ?? 'Submitted. CRAVE will review your documents and email you.');
  }

  return (
    <div className="stack">
      <label>Food business licence number<input value={licence} onChange={(e) => setLicence(e.target.value)} /></label>
      <label>Documents (food business licence, ABN registration, owner ID)
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Documents are stored privately and only visible to your restaurant’s managers and CRAVE administrators.</p>
      {status ? <p className="muted" role="status">{status}</p> : null}
      <div><button className="btn" disabled={busy || !files.length || !licence} onClick={submit}>{busy ? 'Submitting…' : 'Submit for verification'}</button></div>
    </div>
  );
}
