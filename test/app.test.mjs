import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "../src/server.mjs";
import { LeagueStore } from "../src/store.mjs";

test("los equipos comparten monitores y el servidor conserva las plantillas semanales", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "fantasyscout-test-"));
  const options = {
    databasePath: join(dir, "league.sqlite"),
    adminPassword: "organization-test-password",
    inviteCode: "test-invite",
  };
  const password = "scouter-test-password";
  let server;
  let origin;

  async function boot() {
    server = createApp(options);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  }

  async function stop() {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }

  t.after(async () => {
    await stop();
    await rm(dir, { force: true, recursive: true });
  });

  function client() {
    let cookie;
    return async (path, method = "GET", body, extraHeaders = {}) => {
      const headers = { ...extraHeaders };
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(origin + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const session = response.headers.get("Set-Cookie");
      if (session) {
        assert.match(session, /HttpOnly/);
        assert.match(session, /SameSite=Strict/);
        cookie = session.split(";")[0];
      }
      return { status: response.status, body: await response.json() };
    };
  }

  await boot();
  const guest = client();
  const admin = client();
  const manager = client();
  const reviewer = client();
  const other = client();
  const adminRound = "/api/admin/rounds/1";
  const roster = (request, monitorIds) => request("/api/roster", "PUT", { monitorIds });
  const transfer = (request, monitorId, action) => request("/api/roster", "PATCH", { monitorId, action });
  const score = (id) => `/api/rounds/1/scores/${id}`;
  const monitor = (name, sectionId) => admin("/api/admin/monitors", "POST", { name, sectionId });
  const adminLogin = { role: "admin", password: options.adminPassword };
  const register = (request, alias, team, sectionId, inviteCode = options.inviteCode) =>
    request("/api/register", "POST", { alias, team, sectionId, password, inviteCode });

  assert.deepEqual((await guest("/api/state")).body, { viewer: null, sections: [{ id: 1, name: "Tropa Jungla" }] });
  assert.equal((await guest("/api/admin/sections", "POST", { name: "Manada" })).status, 401);
  assert.equal((await admin("/api/login", "POST", adminLogin, { Origin: "https://example.invalid" })).status, 403);
  assert.equal((await admin("/api/login", "POST", adminLogin)).status, 200);
  assert.equal((await admin("/api/admin/sections", "POST", { name: "Manada" })).status, 201);
  assert.equal((await admin(adminRound, "PATCH", { date: "2026-02-30" })).status, 400);
  assert.equal((await admin(adminRound, "PATCH", { date: "2026-11-14", challenge: "Un juego para compartir." })).status, 200);
  assert.equal((await admin("/api/admin/rounds", "POST", {})).status, 201);

  assert.equal((await register(manager, "Dani", "Los Mapas", 1, "incorrecto")).status, 403);
  assert.equal((await register(manager, "Dani", "Los Mapas", 1)).status, 201);
  assert.equal((await register(reviewer, "Alba", "Norte", 2)).status, 201);
  assert.equal((await register(other, "Vega", "Los Faroles", 1)).status, 201);
  assert.equal((await register(guest, "DANI", "Otro equipo", 2)).status, 409);

  assert.equal((await admin("/api/state")).body.monitors.length, 0);
  assert.equal((await monitor("Alba", 2)).status, 201);
  assert.equal((await monitor("Rubén", 1)).status, 201);
  assert.equal((await monitor("Dani", 1)).status, 201);
  assert.equal((await monitor("ALBA", 2)).status, 409);
  const { players, monitors } = (await admin("/api/state")).body;
  const playerId = (alias) => players.find((entry) => entry.alias === alias).id;
  const monitorId = (name) => monitors.find((entry) => entry.name === name).id;
  const chosen = [monitorId("Alba"), monitorId("Rubén")];
  assert.equal((await manager(adminRound, "PATCH", { action: "open" })).status, 403);
  assert.equal((await roster(manager, [999])).status, 400);
  assert.equal((await roster(manager, [chosen[0], chosen[0]])).status, 400);
  assert.equal((await transfer(guest, chosen[0], "sign")).status, 401);
  assert.equal((await transfer(admin, chosen[0], "sign")).status, 403);
  assert.equal((await transfer(manager, 999, "sign")).status, 400);
  assert.equal((await transfer(manager, chosen[0], "swap")).status, 400);
  const signed = await Promise.all(chosen.map((id) => transfer(manager, id, "sign")));
  assert.deepEqual(signed.map(({ status }) => status), [200, 200]);
  assert.equal((await transfer(manager, chosen[0], "sign")).status, 200);
  assert.deepEqual((await manager("/api/state")).body.roster, chosen);
  assert.equal((await roster(other, [chosen[0]])).status, 200);
  assert.equal((await admin("/api/admin/settings", "PATCH", { rosterSize: 1 })).status, 409);
  assert.equal((await admin("/api/admin/settings", "PATCH", { rosterSize: 2 })).status, 200);
  assert.equal((await transfer(manager, monitorId("Dani"), "sign")).status, 400);
  assert.equal((await admin(adminRound, "PATCH", { action: "open" })).status, 200);
  assert.equal((await admin("/api/admin/sections/1", "PATCH", { reviewerId: playerId("Alba") })).status, 400);
  assert.equal((await admin("/api/admin/sections/2", "PATCH", { reviewerId: playerId("Alba") })).status, 200);
  assert.equal((await admin(score(monitorId("Dani")), "PUT", { categories: ["task"] })).status, 409);
  assert.equal((await admin(adminRound, "PATCH", { action: "lock" })).status, 200);
  for (const id of chosen) assert.equal((await transfer(manager, id, "release")).status, 200);
  assert.equal((await transfer(manager, chosen[0], "release")).status, 200);
  assert.equal((await transfer(manager, monitorId("Dani"), "sign")).status, 200);
  // Repetir la petición de inicio después de cambiar el equipo conserva la primera captura.
  assert.equal((await admin(adminRound, "PATCH", { action: "lock" })).status, 200);
  assert.equal((await reviewer(score(monitorId("Dani")), "PUT", { categories: ["task"] })).status, 403);
  assert.equal((await reviewer(score(monitorId("Alba")), "PUT", { categories: ["task"], note: "Material preparado" })).status, 200);
  assert.equal((await admin(score(monitorId("Dani")), "PUT", { categories: ["task", "help", "challenge", "improvement"] })).status, 200);
  assert.equal((await admin(score(monitorId("Rubén")), "PUT", { categories: ["challenge"] })).status, 200);

  const managerState = (await manager("/api/state")).body;
  assert.equal(managerState.standings[0].team, "Los Mapas");
  assert.equal(managerState.standings[0].total, 5);
  assert.equal(managerState.standings[1].total, 3);
  assert.deepEqual(managerState.reviewScores, []);
  assert.deepEqual(managerState.roster, [monitorId("Dani")]);
  assert.deepEqual(managerState.weeklyRosters, [{ playerId: playerId("Dani"), roundId: 1, monitorIds: chosen }]);
  const reviewState = (await reviewer("/api/state")).body;
  assert.deepEqual(reviewState.viewer.reviewIds, [2]);
  assert.equal(reviewState.reviewScores.length, 1);
  assert.equal(reviewState.reviewScores[0].note, "Material preparado");
  assert.deepEqual(reviewState.weeklyRosters, []);

  assert.equal((await admin(adminRound, "PATCH", { action: "close" })).status, 200);
  assert.equal((await admin(score(monitorId("Rubén")), "PUT", { categories: ["task"] })).status, 409);
  assert.equal((await admin(adminRound, "PATCH", { action: "reopen" })).status, 200);
  assert.equal((await admin(score(monitorId("Rubén")), "PUT", { categories: ["task"] })).status, 200);
  assert.equal((await admin(adminRound, "PATCH", { action: "close" })).status, 200);
  await stop();
  await boot();

  const reloaded = (await manager("/api/state")).body;
  assert.equal(reloaded.viewer.player.alias, "Dani");
  assert.equal(reloaded.rounds[0].status, "closed");
  assert.equal(reloaded.rounds[0].challenge, "Un juego para compartir.");
  assert.equal(reloaded.rounds.at(-1).id, 5);
  assert.equal(reloaded.rosterSize, 2);
  assert.equal(reloaded.standings[0].total, 6);
  assert.deepEqual(reloaded.roster, [monitorId("Dani")]);
  assert.deepEqual(reloaded.weeklyRosters[0].monitorIds, chosen);
  assert.equal((await manager("/api/logout", "POST", {})).status, 200);
  assert.equal((await manager("/api/state")).body.viewer, null);
  assert.equal((await manager("/api/login", "POST", { alias: "dani", password })).status, 200);
});

test("SQLite migra los fichajes y los puntos individuales de la liga anterior una sola vez", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "fantasyscout-migration-"));
  const path = join(dir, "league.sqlite");
  t.after(() => rm(dir, { force: true, recursive: true }));
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(`
      CREATE TABLE sections (id INTEGER PRIMARY KEY, name TEXT, name_key TEXT, reviewer_id INTEGER);
      CREATE TABLE players (id INTEGER PRIMARY KEY, alias TEXT, alias_key TEXT, team TEXT, section_id INTEGER, password_hash TEXT);
      CREATE TABLE rounds (id INTEGER PRIMARY KEY, challenge TEXT, date TEXT, status TEXT DEFAULT 'planned');
      CREATE TABLE lineups (round_id INTEGER, player_id INTEGER, first_pick_id INTEGER, second_pick_id INTEGER);
      CREATE TABLE scores (round_id INTEGER, player_id INTEGER, mask INTEGER, note TEXT);
      INSERT INTO sections VALUES (1, 'Tropa Jungla', 'tropa jungla', NULL), (2, 'Manada', 'manada', NULL);
      INSERT INTO players VALUES (1, 'Norte', 'norte', 'Mapas', 1, 'test'),
        (2, 'Este', 'este', 'Faroles', 2, 'test'), (3, 'Sur', 'sur', 'Caminos', 1, 'test');
      INSERT INTO rounds VALUES (1, 'Un reto', NULL, 'closed');
      INSERT INTO lineups VALUES (1, 1, 2, 3);
      INSERT INTO scores VALUES (1, 1, 15, ''), (1, 2, 1, ''), (1, 3, 2, '');
    `);
  } finally {
    legacy.close();
  }
  for (let restart = 0; restart < 2; restart++) {
    const store = new LeagueStore(path);
    try {
      const migrated = store.stateFor({ playerId: 1, isAdmin: 0 });
      assert.deepEqual(migrated.monitors.map(({ name }) => name), ["Norte", "Este", "Sur"]);
      assert.deepEqual(migrated.roster, [2, 3]);
      assert.equal(migrated.standings[0].total, 5);
      assert.equal(migrated.monitorPoints.find(({ monitorId }) => monitorId === 1).points, 8);
    } finally {
      store.close();
    }
  }
});
