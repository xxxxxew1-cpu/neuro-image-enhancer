import './style.css';
import { EnhancerClient } from './api/EnhancerClient';
import type { StatusChangeDetail, TaskResult } from './api/types';
import { describeAdjustments } from './shared/params';

const STATUS_LABELS: Record<string, string> = {
  queued: 'В очереди…',
  decoding: 'Декодирование…',
  analyzing: 'Анализ изображения (подбор параметров)…',
  enhancing: 'Применение коррекции…',
  encoding: 'Сохранение результата…',
  done: 'Готово',
  aborted: 'Прервано',
  error: 'Ошибка',
};

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

const els = {
  dropzone: $<HTMLDivElement>('dropzone'),
  fileInput: $<HTMLInputElement>('file-input'),
  controls: $<HTMLElement>('controls'),
  useMl: $<HTMLInputElement>('use-ml'),
  outFormat: $<HTMLSelectElement>('out-format'),
  strength: $<HTMLInputElement>('strength'),
  strengthVal: $<HTMLElement>('strength-val'),
  abortBtn: $<HTMLButtonElement>('abort-btn'),
  statusPanel: $<HTMLElement>('status-panel'),
  statusLabel: $<HTMLSpanElement>('status-label'),
  statusPercent: $<HTMLSpanElement>('status-percent'),
  statusDetail: $<HTMLParagraphElement>('status-detail'),
  progressBar: $<HTMLDivElement>('progress-bar'),
  result: $<HTMLElement>('result'),
  compare: $<HTMLDivElement>('compare'),
  imgBefore: $<HTMLImageElement>('img-before'),
  imgAfter: $<HTMLImageElement>('img-after'),
  compareAfter: $<HTMLDivElement>('compare-after'),
  compareSlider: $<HTMLInputElement>('compare-slider'),
  resultMeta: $<HTMLDivElement>('result-meta'),
  downloadBtn: $<HTMLAnchorElement>('download-btn'),
  resetBtn: $<HTMLButtonElement>('reset-btn'),
  backendBadge: $<HTMLSpanElement>('backend-badge'),
};

const client = new EnhancerClient();
let currentId: string | null = null;
let beforeUrl: string | null = null;
let lastFileName = 'image';
let lastFile: File | null = null;

client.ready.then(({ backend, modelLoaded }) => {
  els.backendBadge.textContent = `движок: ${backend}${modelLoaded ? ' + ИИ' : ' (без модели)'}`;
});

client.addEventListener('statuschange', (e) => {
  const { id, status, progress } = (e as CustomEvent<StatusChangeDetail>).detail;
  if (id !== currentId) return;
  els.statusPanel.hidden = false;
  els.statusLabel.textContent = STATUS_LABELS[status] ?? status;
  els.statusPercent.textContent = `${progress}%`;
  els.progressBar.style.width = `${progress}%`;
  els.progressBar.classList.toggle('error', status === 'error');
  els.abortBtn.hidden = status === 'done' || status === 'error' || status === 'aborted';

  if (status === 'error') {
    const state = client.getStatus(id);
    els.statusDetail.textContent = state?.error ?? 'Произошла ошибка.';
  } else if (status === 'done') {
    const result = client.getResult(id);
    if (result) showResult(result);
  } else if (status === 'aborted') {
    els.statusDetail.textContent = 'Обработка остановлена.';
  } else {
    els.statusDetail.textContent = '';
  }
});

function showResult(result: TaskResult): void {
  els.imgAfter.src = result.url;
  els.result.hidden = false;
  els.compareSlider.value = '50';
  els.compareAfter.style.width = '50%';

  const d = describeAdjustments(result.adjustments);
  els.resultMeta.innerHTML = `
    <span class="chip">${result.engine === 'ml' ? '🤖 нейросеть' : '⚙️ авто-алгоритм'}</span>
    <span class="chip">☀️ яркость ${d.brightness}</span>
    <span class="chip">◐ контраст ${d.contrast}</span>
    <span class="chip">🎨 цветность ${d.saturation}</span>
    <span class="chip">${result.width}×${result.height}</span>
    <span class="chip">${(result.elapsedMs / 1000).toFixed(2)} с</span>`;

  const ext = result.blob.type === 'image/png' ? 'png' : 'jpg';
  els.downloadBtn.href = result.url;
  els.downloadBtn.download = `${stripExt(lastFileName)}-enhanced.${ext}`;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image';
}

async function handleFile(file: File): Promise<void> {
  reset(false);
  lastFile = file;
  lastFileName = file.name || 'image';
  beforeUrl = URL.createObjectURL(file);
  els.imgBefore.src = beforeUrl;
  els.controls.hidden = false;
  els.statusPanel.hidden = false;
  els.statusDetail.textContent = '';

  try {
    currentId = await client.submit(file, {
      format: els.outFormat.value as 'image/jpeg' | 'image/png',
      useML: els.useMl.checked,
      strength: Number(els.strength.value) / 100,
    });
  } catch (err) {
    els.statusLabel.textContent = STATUS_LABELS.error;
    els.statusDetail.textContent = err instanceof Error ? err.message : String(err);
  }
}

function reset(clearInput = true): void {
  if (currentId) {
    client.abort(currentId);
    client.release(currentId);
    currentId = null;
  }
  if (beforeUrl) {
    URL.revokeObjectURL(beforeUrl);
    beforeUrl = null;
  }
  els.result.hidden = true;
  els.progressBar.style.width = '0%';
  els.progressBar.classList.remove('error');
  if (clearInput) {
    els.fileInput.value = '';
    els.controls.hidden = true;
    els.statusPanel.hidden = true;
    lastFile = null;
  }
}

function reprocess(): void {
  if (lastFile) void handleFile(lastFile);
}

// -- Wiring ----------------------------------------------------------------

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') els.fileInput.click();
});
els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files?.[0];
  if (file) void handleFile(file);
});

['dragover', 'dragenter'].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
  }),
);
els.dropzone.addEventListener('drop', (e) => {
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});

els.abortBtn.addEventListener('click', () => {
  if (currentId) client.abort(currentId);
});
els.resetBtn.addEventListener('click', () => reset(true));

// Live controls: update the strength label, and re-process the current image
// when any setting changes.
els.strength.addEventListener('input', () => {
  els.strengthVal.textContent = `${els.strength.value}%`;
});
els.strength.addEventListener('change', reprocess);
els.outFormat.addEventListener('change', reprocess);
els.useMl.addEventListener('change', reprocess);

els.compareSlider.addEventListener('input', () => {
  els.compareAfter.style.width = `${els.compareSlider.value}%`;
});

// Match the before-image aspect ratio so the compare overlay lines up.
els.imgBefore.addEventListener('load', () => {
  els.compare.style.aspectRatio = `${els.imgBefore.naturalWidth} / ${els.imgBefore.naturalHeight}`;
});
