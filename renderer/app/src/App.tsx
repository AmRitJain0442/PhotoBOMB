import React, {useState} from 'react';

import type {ReelStyle, RunResultPayload} from './api';
import * as api from './api';
import {ExportPanel} from './components/ExportPanel';
import {CreateScreen} from './screens/CreateScreen';
import {DevelopingScreen} from './screens/DevelopingScreen';
import {LandingScreen} from './screens/LandingScreen';
import {ReviewScreen} from './screens/ReviewScreen';

export type Phase = 'landing' | 'create' | 'developing' | 'review';

export const App: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('landing');
  const [result, setResult] = useState<RunResultPayload | null>(null);
  const [look, setLook] = useState<{style: ReelStyle; enhance: boolean}>({
    style: 'classic',
    enhance: false,
  });
  const developing = phase === 'developing';

  return (
    <div className="shell">
      <div className="lightfield" aria-hidden>
        <div className="blob blob-safelight" />
        <div className="blob blob-amber" />
        <div className="blob blob-dusk" />
        <div className="grain" />
      </div>
      <header className="brand">
        <button
          className="brand-home"
          disabled={developing}
          onClick={() => setPhase('landing')}
          aria-label="Darkroom home"
        >
          <h1>Darkroom</h1>
        </button>
        <nav className="nav-links" aria-label="Screens">
          <button
            className={phase === 'create' ? 'nav-link active' : 'nav-link'}
            disabled={developing}
            onClick={() => setPhase('create')}
          >
            Create
          </button>
          <button
            className={phase === 'review' ? 'nav-link active' : 'nav-link'}
            disabled={developing || !result}
            title={result ? undefined : 'Your reel will appear here once it develops'}
            onClick={() => setPhase('review')}
          >
            Your reel
          </button>
        </nav>
        {developing && <span className="nav-status">developing…</span>}
      </header>
      {phase === 'landing' && <LandingScreen onStart={() => setPhase('create')} />}
      {phase === 'create' && (
        <CreateScreen
          onStarted={(chosen) => {
            setLook(chosen);
            setPhase('developing');
          }}
        />
      )}
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
                avoid: {
                  track_id: result.plan.audio.track_id,
                  summary: result.plan.story.read,
                },
                style: look.style,
                enhance: look.enhance,
              });
              setPhase('developing');
            } catch {
              // stay on review if the retake could not start
            }
          }}
          exportSlot={(edl, assets) => (
            <ExportPanel edl={edl} assets={assets} plan={result.plan} />
          )}
        />
      )}
    </div>
  );
};
