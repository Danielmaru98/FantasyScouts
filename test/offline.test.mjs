import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createOfflineLeague } from "../src/offline.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const getState = (league) => league.request("/api/state", "GET");
const add = (league, alias, team, sectionId) =>
  league.request("/api/admin/players", "POST", { alias, team, sectionId });
const phase = (league, action) => league.request("/api/admin/rounds/1", "PATCH", { action });
const score = (league, id, categories) => league.request(`/api/rounds/1/scores/${id}`, "PUT", { categories });

test("la liga local conserva la jornada, los fichajes y la clasificación al reabrirla", async () => {
  const storage = memoryStorage();
  const league = createOfflineLeague({ storage });
  await league.request("/api/admin/sections", "POST", { name: "Manada" });
  await add(league, "Norte", "Mapas", 1);
  await add(league, "Este", "Faroles", 2);
  await add(league, "Sur", "Rutas", 1);
  await add(league, "Oeste", "Brújulas", 1);
  await assert.rejects(add(league, "norte", "Otro equipo", 2), /alias ya/);

  await phase(league, "open");
  league.viewAs(1);
  const path = "/api/rounds/1/lineup";
  await assert.rejects(league.request(path, "PUT", { firstPickId: 3, secondPickId: 4 }), /otra sección/);
  await league.request(path, "PUT", { firstPickId: 2, secondPickId: 3 });
  league.viewAs(null);
  await phase(league, "lock");
  league.viewAs(1);
  await assert.rejects(league.request(path, "PUT", { firstPickId: 2, secondPickId: 4 }), /cerrados/);
  await assert.rejects(score(league, 2, ["task"]), /sección/);
  league.viewAs(null);
  await score(league, 1, ["task", "help", "help"]);
  await score(league, 2, ["task"]);
  await score(league, 3, ["challenge"]);
  await phase(league, "close");

  const reopened = createOfflineLeague({ storage });
  const state = await getState(reopened);
  assert.equal(state.rounds[0].status, "closed");
  assert.deepEqual(state.standings[0].results[0], { roundId: 1, own: 5, picks: 5, total: 10, scored: true });
  reopened.viewAs(1);
  assert.equal((await getState(reopened)).lineups[0].firstPickId, 2);
});

test("una copia permite trasladar la liga y los errores de importación conservan los datos", async () => {
  const unavailable = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const local = createOfflineLeague({ storage: unavailable });
  await add(local, "Norte", "Mapas", 1);
  assert.match((await getState(local)).storageWarning, /Descarga una copia/);

  const restored = createOfflineLeague({ storage: memoryStorage() });
  await restored.importBackup(local.exportBackup());
  assert.equal((await getState(restored)).players[0].team, "Mapas");
  const invalid = JSON.parse(restored.exportBackup());
  invalid.players[0].sectionId = 999;
  await assert.rejects(restored.importBackup(JSON.stringify(invalid)), /copia válida/);
  assert.equal((await getState(restored)).players[0].sectionId, 1);
});

test("index.html arranca como script clásico con una liga local y sin acceso a la red", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<script[^>]+\bsrc=|<link[^>]+\bhref=|type="module"/i);
  assert.match(html, /<style>[\s\S]+<\/style>/);
  const script = html.match(/<script>([\s\S]+)<\/script>/)?.[1];
  assert.ok(script);

  let fetched = false;
  const mount = { innerHTML: "", addEventListener() {} };
  const browser = { localStorage: memoryStorage(), addEventListener() {} };
  vm.runInNewContext(script, {
    document: { querySelector: () => mount },
    window: browser,
    navigator: {},
    location: { protocol: "file:", hash: "" },
    fetch: () => { fetched = true; throw new Error("network unavailable"); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(mount.innerHTML, /Prepara tu liga/);
  assert.match(mount.innerHTML, /Vista local/);
  assert.equal(fetched, false);
});
