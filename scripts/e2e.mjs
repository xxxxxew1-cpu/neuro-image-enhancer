// End-to-end smoke test in real Chromium: preview the built app, upload a
// generated dark/dull BMP through the actual UI, and assert the worker
// pipeline (decode → analyze → apply → encode) produces a result. Surfaces any
// page/worker error. Run AFTER `npm run build`.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 5180;
const URL = `http://localhost:${PORT}/`;

/** Build a 24-bit BMP: dark, low-contrast, low-saturation content to correct. */
function makeBmp(w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixels = rowSize * h;
  const buf = Buffer.alloc(54 + pixels);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixels, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixels, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // dark, low-contrast, slightly tinted; STRONG vertical gradient (data row
      // y → displayed bottom-up) so an accidental flip is detectable.
      const t = y / h;
      const base = 30 + t * 70;
      const off = 54 + y * rowSize + x * 3;
      buf[off] = Math.round(base * 0.95); // B
      buf[off + 1] = Math.round(base * 1.0); // G
      buf[off + 2] = Math.round(base * 1.05); // R
    }
  }
  return buf;
}

async function waitForServer(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('preview server did not start');
}

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  shell: true,
  stdio: 'ignore',
});

let browser;
let failed = false;
try {
  await waitForServer(URL);
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle' });

  // Wait until the worker reports ready (backend badge updates).
  await page.waitForFunction(
    () => /движок:/.test(document.getElementById('backend-badge')?.textContent || '') &&
      !/…$/.test(document.getElementById('backend-badge')?.textContent || ''),
    { timeout: 15000 },
  );
  const badge = await page.textContent('#backend-badge');
  console.log(`backend badge: ${badge}`);

  // Upload the generated BMP through the real file input.
  await page.setInputFiles('#file-input', {
    name: 'test.bmp',
    mimeType: 'image/bmp',
    buffer: makeBmp(400, 300),
  });

  // Wait for a finished result.
  await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
  const afterSrc = await page.getAttribute('#img-after', 'src');
  const meta = (await page.textContent('#result-meta'))?.replace(/\s+/g, ' ').trim();
  console.log(`result meta: ${meta}`);

  if (!afterSrc || !afterSrc.startsWith('blob:')) throw new Error('no result image produced');
  if (!meta || !meta.includes('×')) throw new Error('result meta missing dimensions');

  // Orientation consistency: the test BMP is brighter at the top. Both the
  // "before" original and the "after" result must keep that (top minus bottom
  // luminance > 0). Catches any flip/rotation regression in the pipeline.
  const orient = await page.evaluate(() => {
    const topMinusBottom = (img) => {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let top = 0;
      let bot = 0;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const i = (y * 32 + x) * 4;
          const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          if (y < 16) top += l;
          else bot += l;
        }
      return (top - bot) / (16 * 32);
    };
    return {
      before: topMinusBottom(document.getElementById('img-before')),
      after: topMinusBottom(document.getElementById('img-after')),
    };
  });
  console.log(`orientation top-bottom luma: before=${orient.before.toFixed(1)} after=${orient.after.toFixed(1)}`);
  if (orient.before <= 0 || orient.after <= 0 || Math.sign(orient.before) !== Math.sign(orient.after)) {
    throw new Error(`orientation mismatch (before=${orient.before.toFixed(1)}, after=${orient.after.toFixed(1)})`);
  }

  if (errors.length) {
    console.error('⚠️ page/worker errors:\n' + errors.join('\n'));
    failed = true;
  } else {
    console.log('✓ e2e: image processed end-to-end with no errors');
  }
} catch (e) {
  console.error('❌ e2e failed:', e.message);
  failed = true;
} finally {
  if (browser) await browser.close();
  preview.kill();
}
process.exit(failed ? 1 : 0);
