// Bundle everything into ONE file you can download and double-click:
//   node tools/build.mjs   ->   dist/ThockScope.html
// CSS and JS are inlined, and every css/assets/*.svg reference (in CSS url(...) or
// HTML src="...") becomes a data: URI, so the file needs nothing next to it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let html = await readFile(join(root, 'index.html'), 'utf8');

html = await replaceAsync(html, /<link rel="stylesheet" href="([^"]+)">/g, async (_, href) =>
  `<style>\n${await readFile(join(root, href), 'utf8')}\n</style>`);
html = await replaceAsync(html, /<script src="([^"]+)"><\/script>/g, async (_, src) => {
  const js = (await readFile(join(root, src), 'utf8')).replace(/<\/script/gi, '<\\/script');
  return `<script>\n${js}\n</script>`;
});

// CSS: url("assets/x.svg")  |  HTML: src="css/assets/x.svg"
const svgUri = async (name) =>
  'data:image/svg+xml,' + encodeURIComponent((await readFile(join(root, 'css', 'assets', name), 'utf8')).trim());
let inlined = 0;
html = await replaceAsync(html, /url\(["']?assets\/([\w-]+\.svg)["']?\)/g, async (_, name) => { inlined++; return `url("${await svgUri(name)}")`; });
html = await replaceAsync(html, /src="css\/assets\/([\w-]+\.svg)"/g, async (_, name) => { inlined++; return `src="${await svgUri(name)}"`; });

const leftovers = html.match(/(["'(])(css\/)?assets\//g);
if (leftovers) throw new Error(`Un-inlined asset references remain: ${leftovers.length}`);

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'ThockScope.html'), html);
console.log(`dist/ThockScope.html  (${(html.length / 1024).toFixed(0)} KB, ${inlined} images inlined)`);

async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) { parts.push(str.slice(last, m.index), await fn(...m)); last = m.index + m[0].length; }
  parts.push(str.slice(last));
  return parts.join('');
}
