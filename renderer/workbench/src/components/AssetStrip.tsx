import React, {useRef, useState} from 'react';
import type {AssetInfo} from '../App';

const IMAGE_RE = /\.(jpe?g|png|webp|svg)$/i;

export const AssetStrip: React.FC<{
  assets: AssetInfo[];
  onUploaded: () => void;
}> = ({assets, onUploaded}) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const send = async (files: FileList | File[]) => {
    const fd = new FormData();
    for (const f of Array.from(files as ArrayLike<File>)) fd.append('files', f);
    setBusy(true);
    try {
      const r = await fetch('/api/assets', {method: 'POST', body: fd});
      const body = await r.json();
      setMessage(r.ok ? `added: ${body.saved.join(', ')}` : body.error);
      if (r.ok) onUploaded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="assets"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        send(e.dataTransfer.files);
      }}
    >
      <div className="toolbar">
        <span className="label">assets · {assets.length}</span>
        <button disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'uploading…' : 'add photos'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.svg"
          multiple
          hidden
          onChange={(e) => e.target.files && send(e.target.files)}
        />
      </div>
      <div className="filmstrip">
        <div className="thumbs">
          {assets.map((a) =>
            IMAGE_RE.test(a.file) ? (
              <figure key={a.file}>
                <img src={a.url} alt={a.id} />
                <figcaption>{a.id}</figcaption>
              </figure>
            ) : (
              <figure key={a.file} className="audio">
                <span>♪</span>
                <figcaption>{a.id}</figcaption>
              </figure>
            ),
          )}
        </div>
      </div>
      {message && <div className="note">{message}</div>}
    </div>
  );
};
