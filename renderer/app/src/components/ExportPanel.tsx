import React, {useEffect, useRef, useState} from 'react';

import type {Edl} from '../../../src/edl/schema';
import * as api from '../api';
import type {Plan} from '../api';

const POLL_MS = 2000;

type ExportState =
  | {phase: 'idle'}
  | {phase: 'printing'}
  | {phase: 'done'; file: string}
  | {phase: 'failed'};

const CopyButton: React.FC<{text: string; label: string}> = ({text, label}) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-secondary"
      style={{padding: '6px 14px', fontSize: 13}}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
};

export const ExportPanel: React.FC<{
  edl: Edl;
  assets: Record<string, string>;
  plan: Plan;
}> = ({edl, assets, plan}) => {
  const [state, setState] = useState<ExportState>({phase: 'idle'});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = async () => {
    setState({phase: 'printing'});
    try {
      const {file} = await api.startRender(edl, assets);
      for (;;) {
        await new Promise((res) => setTimeout(res, POLL_MS));
        if (!alive.current) return;
        const status = await api.renderStatus();
        if (status.state === 'done') {
          setState({phase: 'done', file});
          return;
        }
        if (status.state === 'failed') {
          setState({phase: 'failed'});
          return;
        }
      }
    } catch {
      if (alive.current) setState({phase: 'failed'});
    }
  };

  const hashtags = plan.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');

  return (
    <div className="card">
      <h2>Share it</h2>
      <div className="stack">
        {state.phase === 'idle' && (
          <button className="btn btn-primary" onClick={start}>
            Export video
          </button>
        )}
        {state.phase === 'printing' && <span className="hint">Printing your reel…</span>}
        {state.phase === 'failed' && (
          <>
            <span className="error-note">The export hit a snag — try again.</span>
            <button className="btn btn-primary" onClick={start}>
              Try again
            </button>
          </>
        )}
        {state.phase === 'done' && (
          <>
            <a
              className="btn btn-primary"
              style={{textAlign: 'center', textDecoration: 'none', display: 'block'}}
              href={`/renders/${state.file}`}
              download
            >
              Save video
            </a>
            <span className="success-note">Fresh out of the darkroom.</span>
          </>
        )}

        <div className="stack" style={{gap: 8}}>
          <div className="spread">
            <strong>Caption</strong>
            <CopyButton text={plan.captions.short} label="Copy short" />
          </div>
          <p style={{margin: 0, color: 'var(--ink-dim)'}}>{plan.captions.short}</p>
          <div className="spread">
            <span />
            <CopyButton text={plan.captions.long} label="Copy long" />
          </div>
          <p style={{margin: 0, color: 'var(--ink-dim)'}}>{plan.captions.long}</p>
          <div className="spread">
            <strong>Hashtags</strong>
            <CopyButton text={hashtags} label="Copy" />
          </div>
          <p style={{margin: 0, color: 'var(--ink-dim)', fontSize: 13}}>{hashtags}</p>
        </div>
      </div>
    </div>
  );
};
