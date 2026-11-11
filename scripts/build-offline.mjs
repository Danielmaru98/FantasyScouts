import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, css, league, offline, app] = await Promise.all(
  ["public/index.html", "public/styles.css", "src/league.mjs", "src/offline.mjs", "public/app.js"]
    .map((path) => readFile(new URL(path, root), "utf8")),
);

function replaceAsset(source, tag, contents) {
  if (!source.includes(tag)) throw new Error(`Etiqueta de recurso ausente: ${tag}`);
  return source.replace(tag, () => contents);
}

const rules = league.replace(/^export /gm, "");
const adapter = offline.replace(/^import [^\n]+\n/, "").replace(/^export /gm, "");
const script = `(() => {
  "use strict";
${rules}
${adapter}
  function readBrowserCapability(read) {
    try { return read(); } catch { return null; }
  }
  window.fantasyScoutLocal = createOfflineLeague({
    storage: readBrowserCapability(() => window.localStorage),
    locks: readBrowserCapability(() => navigator.locks),
  });
${app}
})();`;

let output = html.replace("<!doctype html>", "<!doctype html>\n<!-- Generado con npm run build:offline -->");
output = replaceAsset(output, '<link rel="stylesheet" href="/styles.css">', `<style>\n${css}</style>`);
output = replaceAsset(output, '<script type="module" src="/app.js"></script>',
  `<script>\n${script.replace(/<\/script/gi, "<\\/script")}\n</script>`);
await writeFile(new URL("index.html", root), output);
