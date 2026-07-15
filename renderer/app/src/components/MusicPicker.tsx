import React, {useRef, useState} from 'react';

import type {Track} from '../api';

export const MusicPicker: React.FC<{
  tracks: Track[];
  choice: 'auto' | string;
  onChoice: (choice: 'auto' | string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  showAuto?: boolean;
}> = ({tracks, choice, onChoice, uploading, onUpload, showAuto = true}) => {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (list: FileList | null) => {
    const f = list?.[0];
    if (f) onUpload(f);
  };

  return (
    <div className="card">
      <h2>The song</h2>
      <div className="stack">
        <div className="music-cards" role="radiogroup" aria-label="Song">
          {showAuto && (
            <button
              className={choice === 'auto' ? 'music-card selected' : 'music-card'}
              role="radio"
              aria-checked={choice === 'auto'}
              onClick={() => onChoice('auto')}
            >
              <span>Let Darkroom choose</span>
              <span className="feel">picks what fits your photos</span>
            </button>
          )}
          {tracks.map((t) => (
            <button
              key={t.id}
              className={choice === t.id ? 'music-card selected' : 'music-card'}
              role="radio"
              aria-checked={choice === t.id}
              onClick={() => onChoice(t.id)}
            >
              <span>{t.id.replace(/[_-]+/g, ' ')}</span>
              {t.feel && <span className="feel">{t.feel}</span>}
              <span className="bpm">~{Math.round(t.bpm)} bpm</span>
            </button>
          ))}
        </div>
        {tracks.length === 0 && (
          <div className="empty-note">No songs yet — add an MP3 or WAV to get started.</div>
        )}
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
          {uploading ? 'Listening to your song…' : 'Add a song (MP3 or WAV)'}
          <input
            ref={input}
            type="file"
            accept=".mp3,.wav"
            hidden
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
};
