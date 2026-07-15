import React, {useCallback, useEffect, useState} from 'react';

import * as api from '../api';
import type {Asset, Track} from '../api';
import {MusicPicker} from '../components/MusicPicker';
import {PhotoGrid, isPhoto} from '../components/PhotoGrid';
import {canCreate} from '../lib/gating';

export const CreateScreen: React.FC<{
  onStarted: () => void;
  avoid?: {track_id?: string; summary?: string};
}> = ({onStarted, avoid}) => {
  const [photos, setPhotos] = useState<Asset[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [choice, setChoice] = useState<'auto' | string>('auto');
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
      await api.runPipeline(choice, avoid);
      onStarted();
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
          <div className="stack">
            <button
              className="btn btn-primary"
              disabled={!gate.ok || starting}
              onClick={start}
            >
              {starting ? 'Getting started…' : 'Make my reel'}
            </button>
            {!gate.ok && <span className="hint">{gate.hint}</span>}
            {note && <span className="error-note">{note}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
