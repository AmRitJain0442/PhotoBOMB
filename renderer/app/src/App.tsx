import React, {useState} from 'react';

import type {RunResultPayload} from './api';
import {CreateScreen} from './screens/CreateScreen';
import {DevelopingScreen} from './screens/DevelopingScreen';

export type Phase = 'create' | 'developing' | 'review';

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
  const [result, setResult] = useState<RunResultPayload | null>(null);

  return (
    <div className="shell">
      <header className="brand">
        <h1>Darkroom</h1>
        <span className="tag">photos in, reel out</span>
      </header>
      {phase === 'create' && <CreateScreen onStarted={() => setPhase('developing')} />}
      {phase === 'developing' && (
        <DevelopingScreen
          onDone={(r) => {
            setResult(r);
            setPhase('review');
          }}
          onFailed={() => setPhase('create')}
        />
      )}
      {phase === 'review' && result && <ReviewPlaceholder onBack={() => setPhase('create')} />}
    </div>
  );
};
