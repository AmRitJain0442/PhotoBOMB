import React, {useCallback, useEffect, useState} from 'react';

import * as api from '../api';
import type {Asset, ReelStyle, Track} from '../api';
import {MusicPicker} from '../components/MusicPicker';
import {PhotoGrid, isPhoto} from '../components/PhotoGrid';
import {canCreate} from '../lib/gating';

const STYLES: Array<{value: ReelStyle; label: string; sub: string}> = [
  {value: 'classic', label: 'Classic montage', sub: 'your photos, cut to the beat'},
  {value: 'live', label: 'Live moments', sub: 'a photo or two comes alive'},
  {value: 'film', label: 'AI film', sub: 'one continuous video — uses more magic'},
];

export const CreateScreen: React.FC<{
  onStarted: (look: {style: ReelStyle; enhance: boolean}) => void;
  avoid?: {track_id?: string; summary?: string};
}> = ({onStarted, avoid}) => {
  const [photos, setPhotos] = useState<Asset[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [choice, setChoice] = useState<'auto' | string>('auto');
  const [style, setStyle] = useState<ReelStyle>('classic');
  const [enhance, setEnhance] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [songBusy, setSongBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refreshPhotos = useCallback(async () => {
    setPhotos((await api.listAssets()).filter(isPhoto));
  }, []);
  const refreshTracks = useCallback(async () => {
    setTracks(await api.listTracks());
  }, []);

  useEffect(() => {
    refreshPhotos().catch(() => setNote('The darkroom is not running — restart the app.'));
    refreshTracks().catch(() => undefined);
  }, [refreshPhotos, refreshTracks]);

  const handleUpload = async (files: File[]) => {
    setPhotoBusy(true);
    setNote(null);
    try {
      await api.uploadAssets(files);
      await refreshPhotos();
    } catch (e) {
      setNote(e instanceof api.ApiError ? e.message : 'Those photos did not go through — try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemove = async (file: string) => {
    await api.deleteAsset(file).catch(() => undefined);
    await refreshPhotos();
  };

  const handleSong = async (file: File) => {
    setSongBusy(true);
    setNote(null);
    try {
      const track = await api.uploadTrack(file);
      await refreshTracks();
      setChoice(track.id);
    } catch (e) {
      setNote(
        e instanceof api.ApiError && e.body.message
          ? e.body.message
          : "We couldn't read that song. Try a different MP3 or WAV.",
      );
    } finally {
      setSongBusy(false);
    }
  };

  const gate = canCreate({photoCount: photos.length, trackCount: tracks.length, choice});

  const start = async () => {
    setStarting(true);
    setNote(null);
    try {
      await api.runPipeline(choice, {avoid, style, enhance});
      onStarted({style, enhance});
    } catch (e) {
      setNote(
        e instanceof api.ApiError && e.body.message
          ? e.body.message
          : 'That did not start — try again.',
      );
      setStarting(false);
    }
  };

  return (
    <div>
      <h2 className="screen-title">Make a reel</h2>
      <p className="screen-sub">Drop in your photos, pick a song, and let Darkroom do the rest.</p>
      <div className="row">
        <div className="col" style={{flex: 2}}>
          <PhotoGrid photos={photos} busy={photoBusy} onUpload={handleUpload} onRemove={handleRemove} />
        </div>
        <div className="col">
          <MusicPicker
            tracks={tracks}
            choice={choice}
            onChoice={setChoice}
            uploading={songBusy}
            onUpload={handleSong}
          />
          <div className="card">
            <h2>The look</h2>
            <div className="stack">
              <div className="seg" role="radiogroup" aria-label="Style">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    role="radio"
                    aria-checked={style === s.value}
                    className={style === s.value ? 'music-card selected' : 'music-card'}
                    onClick={() => setStyle(s.value)}
                  >
                    <span>{s.label}</span>
                    <span className="feel">{s.sub}</span>
                  </button>
                ))}
              </div>
              <label className={style === 'film' ? 'switch-row disabled' : 'switch-row'}>
                <input
                  type="checkbox"
                  checked={enhance && style !== 'film'}
                  disabled={style === 'film'}
                  onChange={(e) => setEnhance(e.target.checked)}
                />
                <span>
                  Enhance photos <span className="feel">warm cinematic grade</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
      <div className="dock">
        {!gate.ok && <span className="hint">{gate.hint}</span>}
        {note && <span className="error-note">{note}</span>}
        {gate.ok && !note && <span className="hint" style={{color: 'var(--ink-dim)'}}>Ready when you are.</span>}
        <button className="btn btn-primary" disabled={!gate.ok || starting} onClick={start}>
          {starting ? 'Getting started…' : 'Make my reel'}
        </button>
      </div>
    </div>
  );
};
