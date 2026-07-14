import React, {useCallback, useEffect, useMemo, useState} from 'react';
import fixture from '../../fixtures/montage.json';
import {assetsFromFiles, edlFromText} from './lib/edl-text';
import type {Edl} from '../../src/edl/schema';
import {EdlEditor} from './components/EdlEditor';
import {PreviewPane} from './components/PreviewPane';
import {AssetStrip} from './components/AssetStrip';
import {RenderPanel} from './components/RenderPanel';

export type AssetInfo = {id: string; file: string; url: string};

export const App: React.FC = () => {
  const [text, setText] = useState(() => JSON.stringify(fixture.edl, null, 2));
  const [assetFiles, setAssetFiles] = useState<AssetInfo[]>([]);

  const refreshAssets = useCallback(async () => {
    const r = await fetch('/api/assets');
    setAssetFiles(await r.json());
  }, []);
  useEffect(() => {
    refreshAssets();
  }, [refreshAssets]);

  const assets = useMemo(
    () => assetsFromFiles(assetFiles.map((a) => a.file)),
    [assetFiles],
  );
  const {edl, errors} = useMemo(
    () => edlFromText(text, new Set(Object.keys(assets))),
    [text, assets],
  );

  const [lastValid, setLastValid] = useState<Edl | null>(null);
  useEffect(() => {
    if (edl) setLastValid(edl);
  }, [edl]);

  return (
    <div className="app">
      <header>
        <span className={edl ? 'lamp ok' : 'lamp bad'} aria-hidden="true" />
        <h1>darkroom / edl workbench</h1>
        <span className={edl ? 'chip ok' : 'chip bad'}>
          {edl ? 'valid edl' : `${errors.length} error${errors.length === 1 ? '' : 's'}`}
        </span>
      </header>
      <main>
        <section className="left">
          <EdlEditor
            text={text}
            errors={errors}
            onChange={setText}
            onLoadFixture={() => setText(JSON.stringify(fixture.edl, null, 2))}
          />
        </section>
        <section className="right">
          <PreviewPane edl={lastValid} assets={assets} stale={!edl} />
          <AssetStrip assets={assetFiles} onUploaded={refreshAssets} />
          <RenderPanel edl={edl} assets={assets} />
        </section>
      </main>
    </div>
  );
};
