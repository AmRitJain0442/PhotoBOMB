import React, {useState} from 'react';

import type {RunResultPayload} from './api';
import * as api from './api';
import {CreateScreen} from './screens/CreateScreen';
import {DevelopingScreen} from './screens/DevelopingScreen';
import {ReviewScreen} from './screens/ReviewScreen';

export type Phase = 'create' | 'developing' | 'review';

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
      {phase === 'review' && result && (
        <ReviewScreen
          result={result}
          onResult={setResult}
          onAnotherTake={async () => {
            try {
              await api.runPipeline('auto', {
                track_id: result.plan.audio.track_id,
                summary: result.plan.story.read,
              });
              setPhase('developing');
            } catch {
              // stay on review if the retake could not start
            }
          }}
        />
      )}
    </div>
  );
};
