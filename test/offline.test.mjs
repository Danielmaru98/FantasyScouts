import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createOfflineLeague } from "../src/offline.mjs";
import { DEFAULT_MARKET_VALUE_CENTS, STARTER_CHALLENGES } from "../src/league.mjs";

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
const monitor = (league, name, sectionId, marketValueCents) =>
  league.request("/api/admin/monitors", "POST", { name, sectionId, marketValueCents });
const setValue = (league, id, marketValueCents) =>
  league.request(`/api/admin/monitors/${id}`, "PATCH", { marketValueCents });
const phase = (league, action, round = 1) => league.request(`/api/admin/rounds/${round}`, "PATCH", { action });
const score = (league, id, categories, round = 1) => league.request(`/api/rounds/${round}/scores/${id}`, "PUT", { categories });
const roster = (league, monitorIds) => league.request("/api/roster", "PUT", { monitorIds });
const transfer = (league, monitorId, action) => league.request("/api/roster", "PATCH", { monitorId, action });

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
  await league.request("/api/admin/settings", "PATCH", { rosterSize: 2 });
  await assert.rejects(transfer(league, 2, "sign"), /vista de un mánager/);

  league.viewAs(1);
  await assert.rejects(roster(league, [2, 2]), /una plaza/);
  await roster(league, [2]);
  await transfer(league, 3, "sign");
  await transfer(league, 3, "sign");
  await assert.rejects(transfer(league, 1, "sign"), /hasta 2/);
  assert.deepEqual((await getState(league)).roster, [2, 3]);
  league.viewAs(null);
  await phase(league, "open");
  await phase(league, "lock");
  league.viewAs(1);
  await transfer(league, 2, "release");
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
  assert.ok(view.monitors.every(({ marketValueCents }) => marketValueCents === DEFAULT_MARKET_VALUE_CENTS));
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
  await monitor(local, "Junco", 1, 148_250);
  assert.match((await getState(local)).storageWarning, /Descarga una copia/);

  const restored = createOfflineLeague({ storage: memoryStorage() });
  await restored.importBackup(local.exportBackup());
  assert.equal((await getState(restored)).players[0].team, "Mapas");
  assert.equal((await getState(restored)).monitors[0].marketValueCents, 148_250);
  const invalid = JSON.parse(restored.exportBackup());
  invalid.players[0].sectionId = 999;
  await assert.rejects(restored.importBackup(JSON.stringify(invalid)), /copia válida/);
  assert.equal((await getState(restored)).players[0].sectionId, 1);
});

test("el registro de monitores persiste y las copias se importan sin duplicar registros", async () => {
  const storage = memoryStorage();
  const source = createOfflineLeague({ storage });
  await source.request("/api/admin/sections", "POST", { name: "Manada" });
  await monitor(source, "Senda", 1);
  await monitor(source, "Olmo", 2, 155_050);
  await assert.rejects(setValue(source, 1, -5), /valor en euros/);
  await setValue(source, 1, 223_450);

  const reopened = createOfflineLeague({ storage });
  assert.deepEqual((await getState(reopened)).monitors.map(({ name }) => name), ["Senda", "Olmo"]);
  const register = reopened.exportMonitorRegister();
  assert.deepEqual(JSON.parse(register).monitors, [
    { name: "Senda", section: "Tropa Jungla", marketValueCents: 223_450 },
    { name: "Olmo", section: "Manada", marketValueCents: 155_050 },
  ]);

  const target = createOfflineLeague({ storage: memoryStorage() });
  await add(target, "Mapa", "Brújulas", 1);
  await monitor(target, "SENDA", 1);
  target.viewAs(1);
  await roster(target, [1]);
  await assert.rejects(setValue(target, 1, 350_000), { status: 403 });
  target.viewAs(null);
  assert.equal(await target.importMonitorRegister(register), 1);
  assert.equal(await target.importMonitorRegister(reopened.exportBackup()), 0);
  await assert.rejects(target.importMonitorRegister("no es un JSON"), /copia válida/);
  const view = await getState(target);
  assert.deepEqual(view.monitors, [
    { id: 1, name: "SENDA", sectionId: 1, marketValueCents: DEFAULT_MARKET_VALUE_CENTS },
    { id: 2, name: "Olmo", sectionId: 2, marketValueCents: 155_050 },
  ]);
  assert.equal(view.sections[1].name, "Manada");
  target.viewAs(1);
  assert.deepEqual((await getState(target)).roster, [1]);
});

test("el registro avisa si el navegador acepta el guardado pero descarta los cambios", async () => {
  const storage = { getItem: () => null, setItem() {} };
  const league = createOfflineLeague({ storage });
  await monitor(league, "Senda", 1);
  const view = await getState(league);
  assert.match(view.storageWarning, /Descarga una copia desde Monitores/);
  assert.equal(JSON.parse(league.exportMonitorRegister()).monitors[0].name, "Senda");
  assert.equal((await getState(createOfflineLeague({ storage }))).monitors.length, 0);
});

test("index.html arranca sin red y permite registrar y alinear monitores por clic", async () => {
  const [html, pagesHtml] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
  ]);
  assert.equal(pagesHtml, html);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=|<link[^>]+\bhref=|type="module"/i);
  assert.match(html, /<style>[\s\S]+<\/style>/);
  const script = html.match(/<script>([\s\S]+)<\/script>/)?.[1];
  assert.ok(script);

  let fetched = false;
  const listeners = new Map();
  const mount = { innerHTML: "", addEventListener: (name, callback) => listeners.set(name, callback) };
  const notice = { classList: { toggle() {} } };
  const browser = { localStorage: memoryStorage(), addEventListener() {} };
  const location = { protocol: "file:", hash: "" };
  vm.runInNewContext(script, {
    document: { querySelector: (selector) => selector === "#app" ? mount : notice, getElementById: () => null },
    window: browser,
    navigator: {},
    location,
    history: { replaceState: (_, __, hash) => { location.hash = hash; } },
    FormData: class extends Map {
      constructor(form) { super(Object.entries(form.values)); }
    },
    clearTimeout() {},
    setTimeout() {},
    fetch: () => { fetched = true; throw new Error("network unavailable"); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(mount.innerHTML, /Prepara tu liga/);
  assert.match(mount.innerHTML, /Vista local/);
  assert.match(mount.innerHTML, /<option value="preview">Vista usuario<\/option>/);

  const switchView = (value) => listeners.get("change")({ target: { dataset: { select: "local-view" }, value } });
  await switchView("preview");
  assert.equal(location.hash, "#alineacion");
  assert.equal((await getState(browser.fantasyScoutLocal)).viewer.role, "preview");
  assert.match(mount.innerHTML, /<option value="preview" selected>Vista usuario<\/option>/);
  assert.match(mount.innerHTML, /Alineación en el campo/);
  assert.doesNotMatch(mount.innerHTML, /data-command="edit-lineup"/);
  await assert.rejects(add(browser.fantasyScoutLocal, "Norte", "Mapas", 1), { status: 403 });
  await switchView("");
  assert.equal(location.hash, "#inicio");

  location.hash = "#monitores";
  const error = {};
  const form = {
    dataset: { form: "add-monitor" },
    values: { name: "Junco", sectionId: "1", marketValue: "1.250,75" },
    reportValidity: () => true,
    querySelector: () => error,
  };
  const button = { type: "submit", form };
  let prevented = false;
  await listeners.get("click")({ target: { closest: () => button }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(mount.innerHTML, /<th scope="row">Junco<\/th>/);
  assert.match(mount.innerHTML, /1\.250,75\s€/);
  assert.match(mount.innerHTML, /<option value="1" selected>Tropa Jungla<\/option>/);
  assert.equal(notice.textContent, "Monitor registrado.");

  await add(browser.fantasyScoutLocal, "Norte", "Mapas", 1);
  await switchView("1");
  assert.equal(location.hash, "#alineacion");
  const navigation = mount.innerHTML.match(/<nav [^>]*>([\s\S]+?)<\/nav>/)?.[1];
  assert.ok(navigation);
  assert.deepEqual(Array.from(navigation.matchAll(/href="#([^"]+)"/g), ([, route]) => route), ["alineacion", "clasificacion"]);
  assert.match(mount.innerHTML, /Alineación en el campo/);

  const editLineup = { dataset: { command: "edit-lineup" }, hasAttribute: () => false };
  await listeners.get("click")({ target: { closest: () => editLineup } });
  assert.match(mount.innerHTML, /Fichar a Junco/);
  const sign = {
    type: "submit",
    form: { ...form, dataset: { form: "market-transfer", id: "1", move: "sign" }, values: {} },
  };
  await listeners.get("click")({ target: { closest: () => sign }, preventDefault() {} });
  assert.equal(notice.textContent, "Monitor fichado.");
  await listeners.get("click")({ target: { closest: () => editLineup } });
  assert.match(mount.innerHTML, /class="pitch-name" title="Junco">Junco/);
  assert.equal(fetched, false);
});
