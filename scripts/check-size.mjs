// Report the built bundle size and fail if it exceeds the 10 MB budget.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const LIMIT_MB = 10;

if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

function walk(dir) {
  let total = 0;
  const items = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = walk(p);
      total += r.total;
      items.push(...r.items);
    } else {
      const size = statSync(p).size;
      total += size;
      items.push([p.replace(root + '\\', '').replace(root + '/', ''), size]);
    }
  }
  return { total, items };
}

const { total, items } = walk(dist);
items.sort((a, b) => b[1] - a[1]);
for (const [p, s] of items) console.log(`${(s / 1024).toFixed(1).padStart(10)} KB  ${p}`);

const mb = total / 1024 / 1024;
console.log('─'.repeat(48));
console.log(`TOTAL: ${mb.toFixed(2)} MB  (limit ${LIMIT_MB} MB)`);
if (mb > LIMIT_MB) {
  console.error(`❌ OVER BUDGET by ${(mb - LIMIT_MB).toFixed(2)} MB`);
  process.exit(1);
}
console.log(`✓ within budget (${(LIMIT_MB - mb).toFixed(2)} MB to spare)`);
