import React from 'react';

export const LandingScreen: React.FC<{onStart: () => void}> = ({onStart}) => (
  <div className="landing">
    <section className="landing-hero">
      <div className="landing-copy">
        <h2 className="landing-title">
          Photos in.
          <br />
          <span className="landing-accent">Reel out.</span>
        </h2>
        <p className="landing-sub">
          Darkroom looks at your photos, finds the story, picks a song and cuts every shot on the
          beat — then hands you a reel with the caption already written.
        </p>
        <div className="landing-cta">
          <button className="btn btn-primary" onClick={onStart}>
            Start a reel
          </button>
          <span className="landing-note">Runs on your machine · about two minutes a take</span>
        </div>
      </div>
      <div className="print-fan" aria-hidden>
        <div className="print print-a" />
        <div className="print print-b" />
        <div className="print print-c">
          <span className="print-quote">
            stay for the <em>light</em>
          </span>
        </div>
      </div>
    </section>
    <section className="steps">
      <div className="step card">
        <span className="step-k">Drop</span>
        <p>Add your photos and a song — or let Darkroom pick the music that fits.</p>
      </div>
      <div className="step card">
        <span className="step-k">Develop</span>
        <p>It weeds out the blurry shots, cuts to the beat, and sets a quote in light.</p>
      </div>
      <div className="step card">
        <span className="step-k">Share</span>
        <p>Reword anything, export the video, and copy the caption and hashtags.</p>
      </div>
    </section>
  </div>
);
