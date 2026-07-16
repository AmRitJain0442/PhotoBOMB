import React, {useEffect, useMemo, useRef, useState} from 'react';

import type {Edl} from '../../../src/edl/schema';
import * as api from '../api';
import type {RunResultPayload, Track} from '../api';
import {PhoneFrame} from '../components/PhoneFrame';
import {TweaksPanel} from '../components/TweaksPanel';
import {setText} from '../lib/edl-tweaks';

const POLL_MS = 2000;

export const ReviewScreen: React.FC<{
  result: RunResultPayload;
  onResult: (r: RunResultPayload) => void;
  onAnotherTake: () => void;
  exportSlot?: (edl: Edl, assets: Record<string, string>) => React.ReactNode;
}> = ({result, onResult, onAnotherTake, exportSlot}) => {
  const [edl, setEdl] = useState<Edl>(result.edl);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [revising, setRevising] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runIdRef = useRef(result.runId);

  useEffect(() => {
    setEdl(result.edl);
    runIdRef.current = result.runId;
  }, [result]);

  useEffect(() => {
    api.listTracks().then(setTracks).catch(() => undefined);
    if (result.assetPaths && Object.keys(result.assetPaths).length > 0) {
      setAssets(result.assetPaths);
      return;
    }
    // older runs served from disk carry no asset map — rebuild from the library
    api
      .listAssets()
      .then((list) => {
        const map: Record<string, string> = {};
        for (const a of list) map[a.id] = `assets/${a.file}`;
        setAssets(map);
      })
      .catch(() => undefined);
  }, [result.assetPaths]);

  const revise = async (patch: {pin?: string; removeAsset?: string}, label: string) => {
    setRevising(label);
    setNote(null);
    try {
      await api.revisePipeline(runIdRef.current, patch);
      // poll until the job settles
      for (;;) {
        await new Promise((res) => setTimeout(res, POLL_MS));
        const status = await api.pipelineStatus();
        if (status.state === 'done' && status.runId) {
          const next = await api.pipelineResult(status.runId);
          onResult(next);
          break;
        }
        if (status.state === 'failed') {
          setNote("That change didn't come out right — kept the current take.");
          break;
        }
      }
    } catch (e) {
      setNote(
        e instanceof api.ApiError && e.body.message
          ? e.body.message
          : "That change didn't go through — try again.",
      );
    } finally {
      setRevising(null);
    }
  };

  const currentTrackId = result.plan.audio.track_id;
  const memoAssets = useMemo(() => assets, [assets]);
  // films carry their own sound and can only be re-taken, not tweaked
  const filmMode = result.edl.mode === 'narrative';

  return (
    <div>
      <h2 className="screen-title">{filmMode ? 'Your film' : 'Your reel'}</h2>
      <p className="screen-sub">{result.plan.story.read}</p>
      <div className="row">
        <div className="col" style={{flex: '0 0 auto', minWidth: 330}}>
          {Object.keys(memoAssets).length > 0 ? (
            <PhoneFrame edl={edl} assets={memoAssets} dimmed={revising !== null} />
          ) : (
            <div className="card" style={{width: 324, height: 557}} />
          )}
          {revising && <span className="hint">{revising}</span>}
          {note && <span className="error-note">{note}</span>}
        </div>
        <div className="col">
          <div className="card">
            <div className="spread">
              <h2 style={{margin: 0}}>Not feeling it?</h2>
              <button className="btn btn-secondary" disabled={revising !== null} onClick={onAnotherTake}>
                Try another take
              </button>
            </div>
          </div>
          {!filmMode && (
            <TweaksPanel
              edl={edl}
              tracks={tracks}
              currentTrackId={currentTrackId}
              assets={memoAssets}
              busy={revising !== null}
              onSetText={(i, content) => setEdl((cur) => setText(cur, i, content))}
              onPinTrack={(id) => revise({pin: id}, 'Re-cutting to the new song…')}
              onRemovePhoto={(id) => revise({removeAsset: id}, 'Re-cutting without that photo…')}
            />
          )}
          {exportSlot?.(edl, memoAssets)}
        </div>
      </div>
    </div>
  );
};
