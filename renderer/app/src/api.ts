// Typed client for the Darkroom server. All UI network traffic goes through
// here so screens never touch fetch directly.
import type {Edl} from '../../src/edl/schema';

export type Asset = {id: string; file: string; url: string};

export type Track = {
  id: string;
  file: string;
  bpm: number;
  beat_grid_ms: number[];
  energy_curve: number[];
  duration_ms: number;
  mood: string;
  feel: string;
};

export type Plan = {
  story: {read: string; type: string; arc_possible: boolean};
  mode: 'montage';
  duration_ms: number;
  selects: string[];
  audio: {track_id: string; reason: string; trim_start_ms: number};
  captions: {short: string; long: string};
  hashtags: string[];
};

export type PipelineStatus = {
  state: 'idle' | 'running' | 'done' | 'failed';
  stage: string | null;
  runId: string | null;
  error: string | null;
  code: string | null;
};

export type RunResultPayload = {runId: string; edl: Edl; plan: Plan};

export type RenderStatus = {
  state: 'idle' | 'running' | 'done' | 'failed';
  file: string | null;
  error: string | null;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: {error?: string; message?: string},
  ) {
    super(body.message ?? body.error ?? `request failed (${status})`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let body: {error?: string; message?: string} = {};
    try {
      body = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });

// ---- assets ----

export const listAssets = (): Promise<Asset[]> => request('/api/assets');

export const uploadAssets = (files: File[]): Promise<{saved: string[]}> => {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  return request('/api/assets', {method: 'POST', body: form});
};

export const deleteAsset = (file: string): Promise<void> =>
  request(`/api/assets/${encodeURIComponent(file)}`, {method: 'DELETE'});

// ---- audio library ----

export const listTracks = (): Promise<Track[]> => request('/api/audio');

export const uploadTrack = (file: File): Promise<Track> => {
  const form = new FormData();
  form.append('file', file);
  return request('/api/audio', {method: 'POST', body: form});
};

// ---- pipeline ----

export const runPipeline = (
  track: 'auto' | string,
  avoid?: {track_id?: string; summary?: string},
): Promise<{runId: string}> => postJson('/api/pipeline/run', {track, avoid});

export const revisePipeline = (
  runId: string,
  patch: {pin?: string; removeAsset?: string},
): Promise<{runId: string}> => postJson('/api/pipeline/revise', {runId, ...patch});

export const pipelineStatus = (): Promise<PipelineStatus> => request('/api/pipeline/status');

export const pipelineResult = (runId: string): Promise<RunResultPayload> =>
  request(`/api/pipeline/result/${encodeURIComponent(runId)}`);

// ---- render ----

export const startRender = (edl: Edl, assets: Record<string, string>): Promise<{file: string}> =>
  postJson('/api/render', {edl, assets});

export const renderStatus = (): Promise<RenderStatus> => request('/api/render/status');
