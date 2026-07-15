import React, {useEffect, useRef, useState} from 'react';

import * as api from '../api';
import type {RunResultPayload} from '../api';
import {copyFor, friendlyError} from '../lib/stage-copy';

const POLL_MS = 2000;

export const DevelopingScreen: React.FC<{
  onDone: (result: RunResultPayload) => void;
  onFailed: () => void;
}> = ({onDone, onFailed}) => {
  const [line, setLine] = useState(copyFor(null));
  const [fading, setFading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const lineRef = useRef(line);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const swapLine = (next: string) => {
      if (next === lineRef.current) return;
      lineRef.current = next;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        setLine(next);
        return;
      }
      setFading(true);
      setTimeout(() => {
        if (cancelled) return;
        setLine(next);
        setFading(false);
      }, 300);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const status = await api.pipelineStatus();
        if (cancelled) return;
        if (status.state === 'failed') {
          setFailure(friendlyError(status.code));
          return;
        }
        if (status.state === 'done' && status.runId) {
          const result = await api.pipelineResult(status.runId);
          if (!cancelled) onDone(result);
          return;
        }
        swapLine(copyFor(status.stage));
      } catch {
        // server hiccup — keep polling
      }
      timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onDone]);

  if (failure) {
    return (
      <div className="develop-room">
        <div className="safelight-glow" style={{opacity: 0.25}} />
        <div className="develop-line">That take didn't come out.</div>
        <p className="error-note" style={{maxWidth: 420, textAlign: 'center'}}>
          {failure}
        </p>
        <button className="btn btn-primary" onClick={onFailed}>
          Back to my photos
        </button>
      </div>
    );
  }

  return (
    <div className="develop-room">
      <div className="safelight-glow" />
      <div className="develop-reel" />
      <div className="develop-line" style={{opacity: fading ? 0 : 1}}>
        {line}
      </div>
    </div>
  );
};
