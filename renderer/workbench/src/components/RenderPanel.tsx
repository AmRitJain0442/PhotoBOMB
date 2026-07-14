import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {Edl} from '../../../src/edl/schema';

type Status = {
  state: 'idle' | 'running' | 'done' | 'failed';
  file: string | null;
  error: string | null;
  logTail: string;
};
type RenderFile = {file: string; url: string};

export const RenderPanel: React.FC<{
  edl: Edl | null;
  assets: Record<string, string>;
}> = ({edl, assets}) => {
  const [status, setStatus] = useState<Status>({state: 'idle', file: null, error: null, logTail: ''});
  const [renders, setRenders] = useState<RenderFile[]>([]);
  const timer = useRef<number>(undefined);

  const refreshRenders = useCallback(async () => {
    setRenders(await (await fetch('/api/renders')).json());
  }, []);
  useEffect(() => {
    refreshRenders();
  }, [refreshRenders]);

  const poll = useCallback(async () => {
    const s: Status = await (await fetch('/api/render/status')).json();
    setStatus(s);
    if (s.state === 'running') {
      timer.current = window.setTimeout(poll, 2000);
    } else if (s.state === 'done' || s.state === 'failed') {
      refreshRenders();
    }
  }, [refreshRenders]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = async () => {
    if (!edl) return;
    const r = await fetch('/api/render', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({edl, assets}),
    });
    if (r.status === 202) {
      setStatus({state: 'running', file: null, error: null, logTail: ''});
      timer.current = window.setTimeout(poll, 2000);
    } else {
      const body = await r.json();
      setStatus({state: 'failed', file: null, error: body.error, logTail: ''});
    }
  };

  return (
    <div className="render">
      <div className="toolbar">
        <button className="primary" disabled={!edl || status.state === 'running'} onClick={start}>
          {status.state === 'running' ? 'rendering…' : 'render mp4'}
        </button>
        <span className={`chip ${status.state}`}>{status.state}</span>
      </div>
      {status.state === 'failed' && status.error && <pre className="errors">{status.error}</pre>}
      {renders.length > 0 && (
        <ul className="renders">
          {renders.slice(0, 5).map((r) => (
            <li key={r.file}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.file}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
