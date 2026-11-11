import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createOfflineLeague } from "../src/offline.mjs";
import { STARTER_CHALLENGES } from "../src/league.mjs";

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
const monitor = (league, name, sectionId) => league.request("/api/admin/monitors", "POST", { name, sectionId });
const phase = (league, action, round = 1) => league.request(`/api/admin/rounds/${round}`, "PATCH", { action });
const score = (league, id, categories, round = 1) => league.request(`/api/rounds/${round}/scores/${id}`, "PUT", { categories });
const roster = (league, monitorIds) => league.request("/api/roster", "PUT", { monitorIds });

test("la liga local congela la plantilla de cada semana y aplica los cambios a la siguiente", async () => {
  const storage = memoryStorage();
  const league = createOfflineLeague({ storage });
  await league.request("/api/admin/sections", "POST", { name: "Manada" });
  await add(league, "Norte", "Mapas", 1);
  await add(league, "Este", "Faroles", 2);
  await monitor(league, "Norte", 1);
  await monitor(league, "Río", 2);
  await monitor(league, "Pino", 1);
  await assert.rejects(add(league, "norte", "Otro equipo", 2), /alias ya/);

  league.viewAs(1);
  await assert.rejects(roster(league, [2, 2]), /una plaza/);
  await roster(league, [2, 3]);
  league.viewAs(null);
  await phase(league, "open");
  await phase(league, "lock");
  league.viewAs(1);
  await roster(league, [3]);
  await assert.rejects(score(league, 2, ["task"]), /sección/);
  league.viewAs(null);
  await score(league, 1, ["task", "help", "help"]);
  await score(league, 2, ["task"]);
  await score(league, 3, ["challenge"]);
  await phase(league, "close");
  await phase(league, "open", 2);
  await phase(league, "lock", 2);
  await score(league, 3, ["improvement"], 2);
  await league.request("/api/admin/rounds", "POST", {});

  const reopened = createOfflineLeague({ storage });
  const state = await getState(reopened);
  assert.equal(state.rounds[0].status, "closed");
  assert.equal(state.rounds.at(-1).id, 5);
  assert.deepEqual(state.standings[0].results.slice(0, 2), [
    { roundId: 1, total: 5, scored: true }, { roundId: 2, total: 1, scored: true },
  ]);
  reopened.viewAs(1);
  assert.deepEqual((await getState(reopened)).roster, [3]);
  assert.deepEqual((await getState(reopened)).weeklyRosters.map(({ monitorIds }) => monitorIds), [[2, 3], [3]]);
});

test("las copias de la versión anterior conservan los monitores, fichajes y puntos individuales", async () => {
  const old = {
    format: "fantasyscout-108", version: 1,
    sections: [{ id: 1, name: "Tropa Jungla", reviewerId: null }, { id: 2, name: "Manada", reviewerId: null }],
    players: [
      { id: 1, alias: "Norte", team: "Mapas", sectionId: 1 },
      { id: 2, alias: "Río", team: "Cauce", sectionId: 2 },
      { id: 3, alias: "Pino", team: "Bosque", sectionId: 1 },
    ],
    rounds: STARTER_CHALLENGES.map((challenge, index) =>
      ({ id: index + 1, challenge, date: null, status: index ? "planned" : "closed" })),
    lineups: [{ roundId: 1, playerId: 1, firstPickId: 2, secondPickId: 3 }],
    scores: [
      { roundId: 1, playerId: 1, mask: 15, note: "Varias aportaciones" },
      { roundId: 1, playerId: 2, mask: 1, note: "Tarea" },
      { roundId: 1, playerId: 3, mask: 2, note: "Apoyo" },
    ],
  };
  const storage = memoryStorage();
  storage.setItem("fantasyscout-108-local-v1", JSON.stringify(old));
  const league = createOfflineLeague({ storage });
  const view = await getState(league);
  assert.deepEqual(view.monitors.map(({ name }) => name), ["Norte", "Río", "Pino"]);
  assert.equal(view.standings[0].total, 5);
  assert.equal(view.monitorPoints.find(({ monitorId }) => monitorId === 1).points, 8);
  league.viewAs(1);
  assert.deepEqual((await getState(league)).roster, [2, 3]);
  assert.equal(JSON.parse(league.exportBackup()).version, 2);
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
