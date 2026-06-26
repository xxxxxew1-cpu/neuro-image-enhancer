import { sniffMime } from '../shared/sniff';
import type {
  StatusChangeDetail,
  SubmitOptions,
  TaskResult,
  TaskState,
  TaskStatus,
  WorkerToMain,
} from './types';
import { TERMINAL_STATUSES } from './types';

/** Anything the caller can hand to {@link EnhancerClient.submit}. */
export type ImageInput = File | Blob | ArrayBuffer | Uint8Array;

export interface EnhancerReady {
  backend: string;
  modelLoaded: boolean;
}

interface TaskRecord {
  state: TaskState;
  buffer: ArrayBuffer | null;
  mime: string;
  fileName?: string;
  options: Required<Pick<SubmitOptions, 'format' | 'quality' | 'useML' | 'strength'>>;
  settle: (s: TaskState) => void;
  settled: Promise<TaskState>;
}

const DEFAULTS: Required<Pick<SubmitOptions, 'format' | 'quality' | 'useML' | 'strength'>> = {
  format: 'image/jpeg',
  quality: 0.92,
  useML: true,
  strength: 0.7,
};

let counter = 0;
function makeId(): string {
  counter += 1;
  return `task_${Date.now().toString(36)}_${counter}`;
}

/**
 * Public, framework-agnostic API for in-browser image enhancement.
 *
 * Methods: {@link submit}, {@link getStatus}, {@link abort}, {@link getResult}.
 * Events: `statuschange` (CustomEvent&lt;StatusChangeDetail&gt;) fired whenever a
 * task's status or progress changes.
 *
 * All heavy work runs in a single Web Worker; tasks are processed one at a
 * time (memory-friendly — only one full-resolution image is in flight).
 */
export class EnhancerClient extends EventTarget {
  private readonly worker: Worker;
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly queue: string[] = [];
  private running: string | null = null;

  /** Resolves once the worker has initialised its backend and (tried to) load the model. */
  readonly ready: Promise<EnhancerReady>;
  private resolveReady!: (r: EnhancerReady) => void;

  constructor() {
    super();
    this.ready = new Promise<EnhancerReady>((res) => (this.resolveReady = res));
    this.worker = new Worker(new URL('../worker/enhance.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.onMessage(e.data);
    // Tell the worker where to fetch the model from (page directory).
    const assetBase = new URL('.', document.baseURI).href;
    this.worker.postMessage({ type: 'init', assetBase });
  }

  // -- Public API ----------------------------------------------------------

  /** Queue an image for enhancement. Resolves with the new task id. */
  async submit(input: ImageInput, options: SubmitOptions = {}): Promise<string> {
    const id = options.id ?? makeId();
    const { buffer, mime, fileName } = await normalize(input, options);

    let settle!: (s: TaskState) => void;
    const settled = new Promise<TaskState>((res) => (settle = res));
    const record: TaskRecord = {
      state: { id, status: 'queued', progress: 0 },
      buffer,
      mime,
      fileName,
      options: {
        format: options.format ?? DEFAULTS.format,
        quality: options.quality ?? DEFAULTS.quality,
        useML: options.useML ?? DEFAULTS.useML,
        strength: options.strength ?? DEFAULTS.strength,
      },
      settle,
      settled,
    };
    this.tasks.set(id, record);
    this.queue.push(id);
    this.emit(id, 'queued', 0);
    this.pump();
    return id;
  }

  /** Current status snapshot for a task. */
  getStatus(id: string): TaskState | undefined {
    const rec = this.tasks.get(id);
    return rec ? { ...rec.state } : undefined;
  }

  /** Request cancellation. Returns true if the request was accepted. */
  abort(id: string): boolean {
    const rec = this.tasks.get(id);
    if (!rec || TERMINAL_STATUSES.has(rec.state.status)) return false;

    const qi = this.queue.indexOf(id);
    if (qi !== -1) {
      // Not started yet — drop it from the queue and settle immediately.
      this.queue.splice(qi, 1);
      this.finalize(id, { status: 'aborted', progress: rec.state.progress });
      return true;
    }
    if (this.running === id) {
      this.worker.postMessage({ type: 'abort', id });
      return true;
    }
    return false;
  }

  /** The finished result, or undefined if the task is not done. */
  getResult(id: string): TaskResult | undefined {
    return this.tasks.get(id)?.state.result;
  }

  /** Resolves when the task reaches a terminal state (done/aborted/error). */
  whenSettled(id: string): Promise<TaskState> {
    const rec = this.tasks.get(id);
    if (!rec) return Promise.reject(new Error(`Неизвестная задача: ${id}`));
    return rec.settled;
  }

  /** Convenience: submit + await completion, returning the result (throws on error/abort). */
  async process(input: ImageInput, options: SubmitOptions = {}): Promise<TaskResult> {
    const id = await this.submit(input, options);
    const state = await this.whenSettled(id);
    if (state.status === 'done' && state.result) return state.result;
    throw new Error(state.error ?? `Задача завершилась со статусом ${state.status}`);
  }

  /** Free a finished task's object URL and forget it. */
  release(id: string): void {
    const rec = this.tasks.get(id);
    if (rec?.state.result?.url) URL.revokeObjectURL(rec.state.result.url);
    this.tasks.delete(id);
  }

  /** Terminate the worker and revoke all object URLs. */
  dispose(): void {
    for (const id of this.tasks.keys()) this.release(id);
    this.worker.terminate();
  }

  // -- Internals -----------------------------------------------------------

  private pump(): void {
    if (this.running || this.queue.length === 0) return;
    const id = this.queue.shift()!;
    const rec = this.tasks.get(id);
    if (!rec || !rec.buffer) return;
    this.running = id;
    const buffer = rec.buffer;
    rec.buffer = null; // released after transfer
    this.worker.postMessage(
      { type: 'process', id, buffer, mime: rec.mime, options: rec.options },
      [buffer],
    );
  }

  private onMessage(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'ready':
        this.resolveReady({ backend: msg.backend, modelLoaded: msg.modelLoaded });
        break;
      case 'status':
        this.update(msg.id, msg.status, msg.progress);
        if (msg.status === 'aborted') {
          this.finalize(msg.id, { status: 'aborted', progress: msg.progress });
        }
        break;
      case 'result': {
        const rec = this.tasks.get(msg.id);
        if (!rec) break;
        const url = URL.createObjectURL(msg.blob);
        const result: TaskResult = {
          blob: msg.blob,
          url,
          adjustments: msg.adjustments,
          engine: msg.engine,
          width: msg.width,
          height: msg.height,
          elapsedMs: msg.elapsedMs,
        };
        this.finalize(msg.id, { status: 'done', progress: 100, result });
        break;
      }
      case 'error':
        this.finalize(msg.id, { status: 'error', progress: 100, error: msg.message });
        break;
    }
  }

  private update(id: string, status: TaskStatus, progress: number): void {
    const rec = this.tasks.get(id);
    if (!rec) return;
    rec.state.status = status;
    rec.state.progress = progress;
    this.emit(id, status, progress);
  }

  private finalize(id: string, patch: Partial<TaskState> & { status: TaskStatus }): void {
    const rec = this.tasks.get(id);
    if (!rec) return;
    rec.state = { ...rec.state, ...patch };
    this.emit(id, rec.state.status, rec.state.progress);
    rec.settle({ ...rec.state });
    if (this.running === id) {
      this.running = null;
      this.pump();
    }
  }

  private emit(id: string, status: TaskStatus, progress: number): void {
    const detail: StatusChangeDetail = { id, status, progress };
    this.dispatchEvent(new CustomEvent<StatusChangeDetail>('statuschange', { detail }));
  }
}

async function normalize(
  input: ImageInput,
  options: SubmitOptions,
): Promise<{ buffer: ArrayBuffer; mime: string; fileName?: string }> {
  let buffer: ArrayBuffer;
  let mime = '';
  let fileName = options.fileName;

  if (input instanceof Blob) {
    buffer = await input.arrayBuffer();
    mime = input.type;
    if (!fileName && input instanceof File) fileName = input.name;
  } else if (input instanceof Uint8Array) {
    const copy = input.slice();
    buffer = copy.buffer as ArrayBuffer;
  } else {
    buffer = input;
  }

  if (!mime) {
    const sniffed = sniffMime(new Uint8Array(buffer.slice(0, 32)));
    if (sniffed) mime = sniffed;
  }
  return { buffer, mime, fileName };
}
