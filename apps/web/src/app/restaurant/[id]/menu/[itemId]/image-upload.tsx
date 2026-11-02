'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { setItemImage } from '../actions';

const MAX = 10 * 1024 * 1024;

export function ImageUpload({ restaurantId, itemId, current }: { restaurantId: string; itemId: string; current: string | null }) {
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState(current);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setStatus('Use a JPG, PNG or WebP image.');
    if (file.size > MAX) return setStatus('Images must be under 10 MB.');
    setStatus('Uploading…');
    const ext = file.type.split('/')[1];
    const path = `${restaurantId}/${itemId}-${Date.now()}.${ext}`;
    const { error } = await supabaseBrowser().storage.from('menu-images').upload(path, file, { contentType: file.type });
    if (error) return setStatus(`Upload failed: ${error.message}`);
    await setItemImage(restaurantId, itemId, path);
    setPreview(URL.createObjectURL(file));
    setStatus('Photo saved');
  }

  return (
    <div className="stack">
      {preview ? <img src={preview} alt="Menu item" style={{ width: 240, height: 240, objectFit: 'cover', borderRadius: 12 }} /> : <p className="muted">No photo yet — customers see this when there’s no video.</p>}
      <label>Upload a photo you own the rights to<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onFile(e.target.files?.[0])} /></label>
      {status ? <p className="muted" role="status">{status}</p> : null}
    </div>
  );
}
