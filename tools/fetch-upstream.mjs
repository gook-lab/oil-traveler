// patch.gg 의 blendi/oil-paint 를 커밋 하나에 고정해 upstream/ 에 그대로 받아요.
// 사용: node tools/fetch-upstream.mjs [커밋]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const API = 'https://patch.gg/api/v1/projects/blendi/oil-paint/repo';
const ref = process.argv[2] ?? '804c65fa3a6c6fcdc732ed1bde450fd140cfb4e9';
const out = 'upstream';

async function walk(path) {
  const res = await fetch(`${API}/tree?ref=${ref}&path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`tree ${path}: ${res.status}`);
  const { entries } = await res.json();
  const files = [];
  for (const e of entries) {
    const p = path ? `${path}/${e.name}` : e.name;
    if (e.type === 'tree') files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}

const files = await walk('');
let bytes = 0;
for (const p of files) {
  const res = await fetch(`${API}/raw?ref=${ref}&path=${encodeURIComponent(p)}`);
  if (!res.ok) throw new Error(`raw ${p}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  bytes += buf.length;
  await mkdir(dirname(join(out, p)), { recursive: true });
  await writeFile(join(out, p), buf);
}
console.log(`${files.length} files, ${(bytes / 1e6).toFixed(1)} MB @ ${ref.slice(0, 7)}`);
