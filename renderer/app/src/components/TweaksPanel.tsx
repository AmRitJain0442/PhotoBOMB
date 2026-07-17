import React, {useState} from 'react';

import type {Edl} from '../../../src/edl/schema';
import type {Track} from '../api';
import {listTexts, usedPhotoIds} from '../lib/edl-tweaks';

export const TweaksPanel: React.FC<{
  edl: Edl;
  tracks: Track[];
  currentTrackId: string;
  assets: Record<string, string>;
  busy: boolean;
  onSetText: (entryIndex: number, content: string) => void;
  onPinTrack: (trackId: string) => void;
  onRemovePhoto: (photoId: string) => void;
}> = ({edl, tracks, currentTrackId, assets, busy, onSetText, onPinTrack, onRemovePhoto}) => {
  const texts = listTexts(edl);
  const photos = usedPhotoIds(edl);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  return (
    <div className="card">
      <h2>Small tweaks</h2>
      <div className="stack">
        {texts.length > 0 && (
          <div className="stack">
            <strong>Words on screen</strong>
            {texts.map((t) => (
              <input
                key={`${t.entryIndex}-${t.content}`}
                className="text-input"
                defaultValue={t.content}
                aria-label="Text on screen"
                disabled={busy}
                onBlur={(e) => {
                  if (e.target.value !== t.content) onSetText(t.entryIndex, e.target.value);
                }}
              />
            ))}
            <span className="feel" style={{color: 'var(--ink-dim)', fontSize: 13}}>
              Clear a line to remove it.
            </span>
          </div>
        )}

        {tracks.length > 1 && (
          <div className="stack">
            <strong>Switch the song</strong>
            <div className="music-cards">
              {tracks.map((t) => (
                <button
                  key={t.id}
                  className={currentTrackId === t.id ? 'music-card selected' : 'music-card'}
                  disabled={busy || currentTrackId === t.id}
                  onClick={() => onPinTrack(t.id)}
                >
                  <span>{t.id.replace(/[_-]+/g, ' ')}</span>
                  {t.feel && <span className="feel">{t.feel}</span>}
                  <span className="bpm">~{Math.round(t.bpm)} bpm</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="stack">
          <strong>Photos in this reel</strong>
          <div className="photo-grid" style={{gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))'}}>
            {photos.map((id) => (
              <div key={id} className="photo-cell">
                {assets[id] && <img src={`/${assets[id]}`} alt={id} loading="lazy" />}
                <button
                  className="remove"
                  title="Take this photo out"
                  aria-label={`Remove ${id}`}
                  disabled={busy}
                  onClick={() => {
                    if (photos.length <= 3) {
                      setPhotoNote('A reel needs at least 3 photos.');
                      return;
                    }
                    setPhotoNote(null);
                    onRemovePhoto(id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {photoNote && <span className="hint">{photoNote}</span>}
        </div>
      </div>
    </div>
  );
};
