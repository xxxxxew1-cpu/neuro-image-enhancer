import type { Adjustments } from '../shared/params';

/** Lifecycle of a single enhancement task. */
export type TaskStatus =
  | 'queued' //      accepted, waiting for the worker
  | 'decoding' //    reading the source bytes into pixels
  | 'analyzing' //   ML / heuristic picking the parameters
  | 'enhancing' //   applying the parameters to the full-res image
  | 'encoding' //    writing the output image
  | 'done' //        finished successfully, result available
  | 'aborted' //     cancelled by the caller
  | 'error'; //      failed

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'done',
  'aborted',
  'error',
]);

/** Which engine actually produced the parameters. */
export type Engine = 'ml' | 'heuristic';

/** Options accepted by {@link EnhancerClient.submit}. */
export interface SubmitOptions {
  /** Output mime type. Default: `image/jpeg`. */
  format?: 'image/jpeg' | 'image/png';
  /** JPEG/WebP quality 0..1. Default: 0.92. */
  quality?: number;
  /** Use the neural network (true) or the classical heuristic (false). Default: true. */
  useML?: boolean;
  /** Correction strength 0..1 (0 = no change, 1 = full). Default: 0.7. */
  strength?: number;
  /** Caller-supplied id; one is generated when omitted. */
  id?: string;
  /** Original file name, used to build the download name. */
  fileName?: string;
}

/** Snapshot returned by {@link EnhancerClient.getStatus}. */
export interface TaskState {
  id: string;
  status: TaskStatus;
  /** Progress in percent, 0..100. */
  progress: number;
  /** Present once the task reaches `done`. */
  result?: TaskResult;
  /** Present when `status === 'error'`. */
  error?: string;
}

/** Metadata + bytes of a finished task. */
export interface TaskResult {
  /** The enhanced image. */
  blob: Blob;
  /** Object URL for the blob (created lazily, revoke when done). */
  url: string;
  /** Parameters that were applied. */
  adjustments: Adjustments;
  /** Engine that chose the parameters. */
  engine: Engine;
  /** Source dimensions. */
  width: number;
  height: number;
  /** Wall-clock processing time in milliseconds. */
  elapsedMs: number;
}

/** Detail payload of the `statuschange` CustomEvent. */
export interface StatusChangeDetail {
  id: string;
  status: TaskStatus;
  progress: number;
}

// ---------------------------------------------------------------------------
// Worker wire protocol (internal)
// ---------------------------------------------------------------------------

export interface WorkerProcessMessage {
  type: 'process';
  id: string;
  buffer: ArrayBuffer; // transferable
  mime: string;
  options: Required<Pick<SubmitOptions, 'format' | 'quality' | 'useML' | 'strength'>>;
}

export interface WorkerAbortMessage {
  type: 'abort';
  id: string;
}

export interface WorkerInitMessage {
  type: 'init';
  /** Base URL the worker should use to fetch the model + wasm assets. */
  assetBase: string;
}

export type MainToWorker = WorkerProcessMessage | WorkerAbortMessage | WorkerInitMessage;

export interface WorkerReadyMessage {
  type: 'ready';
  backend: string;
  modelLoaded: boolean;
}

export interface WorkerStatusMessage {
  type: 'status';
  id: string;
  status: TaskStatus;
  progress: number;
}

export interface WorkerResultMessage {
  type: 'result';
  id: string;
  blob: Blob;
  adjustments: Adjustments;
  engine: Engine;
  width: number;
  height: number;
  elapsedMs: number;
}

export interface WorkerErrorMessage {
  type: 'error';
  id: string;
  message: string;
}

export type WorkerToMain =
  | WorkerReadyMessage
  | WorkerStatusMessage
  | WorkerResultMessage
  | WorkerErrorMessage;
