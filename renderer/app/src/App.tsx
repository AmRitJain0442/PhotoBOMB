import React, {useState} from 'react';

import type {RunResultPayload} from './api';

export type Phase = 'create' | 'developing' | 'review';

// Placeholder screens — replaced by the real ones in Tasks 9–11.
const CreatePlaceholder: React.FC<{onStart: () => void}> = ({onStart}) => (
  <div>
    <h2 className="screen-title">Make a reel</h2>
    <p className="screen-sub">Drop in your photos, pick a song, and let Darkroom do the rest.</p>
    <div className="card">
      <button className="btn btn-primary" onClick={onStart}>
        Make my reel
      </button>
    </div>
  </div>
);

const DevelopingPlaceholder: React.FC<{onDone: () => void}> = ({onDone}) => (
  <div className="develop-room">
    <div className="safelight-glow" />
    <div className="develop-reel" />
    <div className="develop-line">Developing…</div>
    <button className="btn btn-secondary" onClick={onDone}>
      skip
    </button>
  </div>
);

const ReviewPlaceholder: React.FC<{onBack: () => void}> = ({onBack}) => (
  <div>
    <h2 className="screen-title">Your reel</h2>
    <div className="card">
      <button className="btn btn-secondary" onClick={onBack}>
        Start over
      </button>
    </div>
  </div>
);

export const App: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('create');
  const [, setResult] = useState<RunResultPayload | null>(null);

  return (
    <div className="shell">
      <header className="brand">
        <h1>Darkroom</h1>
        <span className="tag">photos in, reel out</span>
      </header>
      {phase === 'create' && <CreatePlaceholder onStart={() => setPhase('developing')} />}
      {phase === 'developing' && (
        <DevelopingPlaceholder
          onDone={() => {
            setResult(null);
            setPhase('review');
          }}
        />
      )}
      {phase === 'review' && <ReviewPlaceholder onBack={() => setPhase('create')} />}
    </div>
  );
};
