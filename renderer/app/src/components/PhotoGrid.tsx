import React, {useRef, useState} from 'react';

import type {Asset} from '../api';

const RASTER = /\.(jpe?g|png|webp)$/i;

export const isPhoto = (a: Asset): boolean => RASTER.test(a.file);

export const PhotoGrid: React.FC<{
  photos: Asset[];
  busy: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (file: string) => void;
}> = ({photos, busy, onUpload, onRemove}) => {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onUpload(Array.from(list as ArrayLike<File>));
  };

  return (
    <div className="card">
      <div className="spread">
        <h2>Your photos</h2>
        <span className="hint" style={{color: 'var(--ink-dim)'}}>
          {photos.length === 0 ? '' : `${photos.length} photo${photos.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="stack">
        <div
          className={dragOver ? 'dropzone active' : 'dropzone'}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files);
          }}
        >
          {busy ? 'Adding photos…' : 'Drop photos here, or click to browse'}
          <input
            ref={input}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            multiple
            hidden
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {photos.length === 0 ? (
          <div className="empty-note">Your photos will appear here.</div>
        ) : (
          <div className="photo-grid">
            {photos.map((p) => (
              <div key={p.file} className="photo-cell">
                <img src={p.url} alt={p.id} loading="lazy" />
                <button
                  className="remove"
                  title="Remove photo"
                  aria-label={`Remove ${p.id}`}
                  onClick={() => onRemove(p.file)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
