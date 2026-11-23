// Bundle everything into ONE file you can download and double-click:
//   node tools/build.mjs   ->   dist/ThockScope.html
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let html = await readFile(join(root, 'index.html'), 'utf8');

html = await replaceAsync(html, /<link rel="stylesheet" href="([^"]+)">/g, async (_, href) =>
  `<style>\n${await readFile(join(root, href), 'utf8')}\n</style>`);
html = await replaceAsync(html, /<script src="([^"]+)"><\/script>/g, async (_, src) => {
  const js = (await readFile(join(root, src), 'utf8')).replace(/<\/script/gi, '<\/script');
  return `<script>\n${js}\n</script>`;
});

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'ThockScope.html'), html);
console.log(`dist/ThockScope.html  (${(html.length / 1024).toFixed(0)} KB)`);

async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) { parts.push(str.slice(last, m.index), await fn(...m)); last = m.index + m[0].length; }
  parts.push(str.slice(last));
  return parts.join('');
}
