# ✨ Neuro Image Enhancer

Улучшение изображений **в реальном времени прямо в браузере** с помощью
ML-модели на TensorFlow.js. Нейросеть подбирает оптимальные параметры коррекции
**яркости, контрастности и цветности**, а быстрый алгоритм применяет их к
изображению. Никаких серверов — изображения не покидают устройство пользователя.

> 🔗 **Демо (GitHub Pages): https://xxxxxew1-cpu.github.io/neuro-image-enhancer/**

---

## Возможности

- 🤖 **ИИ-подбор параметров** — крошечный CNN (~16 тыс. параметров, ~65 КБ)
  анализирует изображение и предсказывает коррекцию яркости / контраста /
  цветности.
- ⚙️ **Классический fallback** — если модель не загрузилась или выдала
  невалидный результат, работает алгоритм авто-коррекции (перцентильное
  растяжение гистограммы + цель по насыщенности). Приложение полезно даже без
  модели.
- 🛟 **«Не навреди»** — коррекция смягчается параметром *силы* (0–100 %, по
  умолчанию 70 %) и не заваливает контраст уже хорошо снятых фото; силу можно
  менять ползунком в UI или опцией `strength` в API.
- 🧵 **Полностью асинхронно** — вся тяжёлая работа в Web Worker, UI не
  подвисает.
- 🖼️ **Форматы**: JPG, PNG, **HEIC**, BMP (а также GIF/WebP). HEIC декодируется
  через libheif (WASM) с динамической загрузкой только при необходимости.
- ⚡ **GPU-применение** — коррекция к полному разрешению (до 15 Мпк) выполняется
  одним проходом WebGL-шейдера; есть точный CPU-fallback.
- 📦 **Размер сборки ~4 МБ** (лимит 10 МБ), главный поток — ~9 КБ JS.
- 🔌 **Чистый API** с методами и событиями (см. ниже).

## Соответствие требованиям ТЗ

| Требование | Реализация |
|---|---|
| Работа во всех современных браузерах | Chrome/Edge/Firefox/Safari; runtime-проверки возможностей и graceful-fallback'и |
| Суммарный объём кода ≤ 10 МБ | ~4 МБ (см. `npm run size`) |
| Обработка изображений до 15 Мпк | `MAX_PIXELS = 15_000_000`, большее автоматически масштабируется |
| Макс. время обработки ≤ 30 с | GPU-проход — десятки мс; CPU-fallback чанкуется и укладывается в бюджет |
| Среднее время ~5 с | На практике 0.05–2 с на типичных изображениях |
| Форматы JPG/PNG/HEIC/BMP | `createImageBitmap` + `heic-to/next` |
| Асинхронный режим без блокировки | Single Web Worker + очередь задач |
| API: постановка/статус/прерывание/получение | `submit` / `getStatus` / `abort` / `getResult` |
| Событие изменения статуса | событие `statuschange` (status + progress) |

## Архитектура

```
Главный поток (UI)                        Web Worker
┌───────────────────────┐  postMessage   ┌──────────────────────────────┐
│ EnhancerClient        │ ─────────────► │ decode (createImageBitmap /   │
│  submit/getStatus/    │                │        heic-to WASM)          │
│  abort/getResult      │                │   ↓ cap 15 Мпк, thumbnail 64² │
│  событие statuschange │ ◄───────────── │ analyze: CNN (TF.js/CPU)      │
└───────────────────────┘   status/      │        или эвристика          │
        ▲                    result       │   ↓ параметры B/C/S           │
        │ events                          │ apply: WebGL-шейдер           │
   demo UI (main.ts)                      │        (CPU-fallback)         │
                                          │   ↓ encode (convertToBlob)    │
                                          └──────────────────────────────┘
```

Ключевая идея: модель «смотрит» только на уменьшенную копию 64×64 (глобальная
яркость/контраст/цветность от масштабирования не меняются) и выдаёт 3 параметра.
Дорогое применение к полному разрешению делает не нейросеть, а
[GPU-шейдер](src/process/webglApply.ts) — это и быстро, и компактно. Математика
коррекции описана один раз в [src/shared/params.ts](src/shared/params.ts) и
**идентично** повторена в шейдере, CPU-пути и в обучении.

## API модуля

```ts
import { EnhancerClient } from './src/api';

const client = new EnhancerClient();
await client.ready; // { backend, modelLoaded }

// 1. Постановка задачи → id
const id = await client.submit(file, { format: 'image/jpeg', useML: true });

// 2. Статус и прогресс
client.addEventListener('statuschange', (e) => {
  const { id, status, progress } = e.detail; // 'analyzing' | 'enhancing' | ...
  console.log(status, progress + '%');
});
const state = client.getStatus(id); // { status, progress, result?, error? }

// 3. Прерывание
client.abort(id);

// 4. Получение результата
const result = client.getResult(id);
// { blob, url, adjustments, engine, width, height, elapsedMs }

// Удобный promise-вариант
const result2 = await client.process(file);
```

| Метод / событие | Назначение |
|---|---|
| `submit(input, options?) → Promise<id>` | Поставить изображение в очередь. `input`: `File \| Blob \| ArrayBuffer \| Uint8Array`; `options`: `{ format, quality, useML, strength }`. |
| `getStatus(id) → TaskState` | Текущий статус и прогресс (0–100). |
| `abort(id) → boolean` | Прервать задачу. |
| `getResult(id) → TaskResult` | Готовое изображение (`Blob` + метаданные). |
| `whenSettled(id) → Promise<TaskState>` | Дождаться завершения. |
| `process(input, options?) → Promise<TaskResult>` | submit + ожидание. |
| событие `statuschange` | `{ id, status, progress }` при каждом изменении. |

Статусы: `queued → decoding → analyzing → enhancing → encoding → done`
(или `aborted` / `error`).

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # сборка в dist/
npm run preview    # предпросмотр сборки
npm run size       # проверка бюджета 10 МБ
npm run typecheck
```

## Обучение модели

```bash
npm run train               # self-supervised, ~700 шагов
node training/verify.mjs    # проверка загружаемости весов
```

Поставляемая модель обучена 600 шагов (эталоны нормального контраста и
насыщенности + «identity»-примеры, чтобы не трогать уже хорошие фото); на
отложенной выборке коррекция снижает MSE к эталону на **~80 %**
(0.0192 → 0.0038), а контраст стал адаптивным (поднимает плоское, не душит
нормальное). Подробности — в [training/README.md](training/README.md). Модель
уже включена в репозиторий (`public/models/enhance/`), переобучать не
обязательно.

## Тестирование

```bash
npm run typecheck                 # строгая проверка типов
npm run build && npm run size     # сборка + контроль бюджета 10 МБ
npx playwright install chromium   # один раз — браузер для e2e
npm run e2e                       # сквозной тест в реальном Chromium
```

`npm run e2e` поднимает предпросмотр сборки, загружает сгенерированный тёмный
BMP через настоящий UI и проверяет, что весь конвейер (decode → анализ →
применение → кодирование) отрабатывает без ошибок в браузере.

## Эталонные изображения и оценка качества

Для пункта ТЗ «формирование пула эталонных изображений»:

1. Соберите 15–30 разнообразных снимков (тёмные/пересвеченные/блёклые/
   нормальные; разные форматы, включая HEIC и BMP; вплоть до 15 Мпк).
2. Прогоните каждый через приложение, сравните «до/после» ползунком.
3. Для количественной оценки используйте метрику из `training/train.mjs`
   (снижение MSE к эталону) либо стандартные PSNR/SSIM на парах
   «искажённое → исправленное».

## Развёртывание на GitHub Pages

`base: './'` в [vite.config.ts](vite.config.ts) делает сборку переносимой на
любой статический хостинг и на project-pages (`/<repo>/`).

Автоматический деплой настроен в
[.github/workflows/deploy.yml](.github/workflows/deploy.yml): включите Pages
(Settings → Pages → Source: **GitHub Actions**) и запушьте в `main`.

Вручную: `npm run build`, затем выложите содержимое `dist/` на любой статический
хостинг (Netlify, Vercel, GitHub Pages, S3 …). Особые заголовки (COOP/COEP) не
нужны.

## Поддержка браузеров и fallback'и

| Возможность | Поведение / запасной путь |
|---|---|
| HEIC | нативно (Safari 17.6+) → libheif WASM (`heic-to/next`, ленивая загрузка) |
| WebGL в воркере | при недоступности (часть Safari/GPU) — точный CPU-проход в воркере |
| OffscreenCanvas | требуется (Baseline 2023); при отсутствии — понятная ошибка |
| TF.js backend | CPU (универсально, без хостинга `.wasm`) |
| Формат вывода | JPEG/PNG; проверка `blob.type` на случай игнорирования типа |

## Структура

```
src/
  api/          публичный EnhancerClient + типы + протокол воркера
  worker/       конвейер обработки (Web Worker)
  ml/           backend TF.js, инференс модели, классический fallback
  process/      decode / resize / WebGL-apply / CPU-apply / encode
  shared/       математика параметров, статистика, sniff форматов
training/        self-supervised обучение (Node, без нативных зависимостей)
public/models/   готовая модель (model.json + weights.bin)
scripts/         проверка размера сборки
```

## Лицензия

MIT. HEIC-декодирование использует libheif (LGPL) через `heic-to`.
