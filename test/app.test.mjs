import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/server.mjs";

test("varios scouters comparten la liga con permisos por sección y datos persistentes", async (t) => {
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
  const third = client();
  const adminRound = "/api/admin/rounds/1";
  const lineup = "/api/rounds/1/lineup";
  const score = (id) => `/api/rounds/1/scores/${id}`;
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

  assert.equal((await register(manager, "Dani", "Los Mapas", 1, "incorrecto")).status, 403);
  assert.equal((await register(manager, "Dani", "Los Mapas", 1)).status, 201);
  assert.equal((await register(reviewer, "Alba", "Norte", 2)).status, 201);
  assert.equal((await register(other, "Vega", "Los Faroles", 1)).status, 201);
  assert.equal((await register(third, "Teo", "Las Rutas", 1)).status, 201);
  assert.equal((await register(guest, "DANI", "Otro equipo", 2)).status, 409);

  const { players } = (await admin("/api/state")).body;
  const id = (alias) => players.find((entry) => entry.alias === alias).id;
  const draft = { firstPickId: id("Alba"), secondPickId: id("Vega") };
  assert.equal((await manager(adminRound, "PATCH", { action: "open" })).status, 403);
  assert.equal((await manager(lineup, "PUT", draft)).status, 409);
  assert.equal((await admin(adminRound, "PATCH", { action: "open" })).status, 200);
  assert.equal((await manager(lineup, "PUT", { firstPickId: id("Teo"), secondPickId: id("Vega") })).status, 400);
  assert.equal((await manager(lineup, "PUT", { firstPickId: id("Alba"), secondPickId: id("Alba") })).status, 400);
  assert.equal((await manager(lineup, "PUT", draft)).status, 200);
  assert.equal((await manager(lineup, "PUT", draft)).status, 200);
  assert.equal((await admin("/api/admin/sections/1", "PATCH", { reviewerId: id("Alba") })).status, 400);
  assert.equal((await admin("/api/admin/sections/2", "PATCH", { reviewerId: id("Alba") })).status, 200);
  assert.equal((await admin(score(id("Dani")), "PUT", { categories: ["task"] })).status, 409);
  assert.equal((await admin(adminRound, "PATCH", { action: "lock" })).status, 200);
  assert.equal((await manager(lineup, "PUT", draft)).status, 409);
  assert.equal((await reviewer(score(id("Dani")), "PUT", { categories: ["task"] })).status, 403);
  assert.equal((await reviewer(score(id("Alba")), "PUT", { categories: ["task"], note: "Material preparado" })).status, 200);
  assert.equal((await admin(score(id("Dani")), "PUT", { categories: ["task", "help", "help"] })).status, 200);
  assert.equal((await admin(score(id("Vega")), "PUT", { categories: ["challenge"] })).status, 200);

  const managerState = (await manager("/api/state")).body;
  assert.equal(managerState.standings[0].team, "Los Mapas");
  assert.equal(managerState.standings[0].total, 10);
  assert.equal(managerState.standings[0].own, 5);
  assert.deepEqual(managerState.reviewScores, []);
  assert.deepEqual(managerState.lineups, [{ playerId: id("Dani"), roundId: 1, ...draft }]);
  const reviewState = (await reviewer("/api/state")).body;
  assert.deepEqual(reviewState.viewer.reviewIds, [2]);
  assert.equal(reviewState.reviewScores.length, 1);
  assert.equal(reviewState.reviewScores[0].note, "Material preparado");
  assert.deepEqual(reviewState.lineups, []);

  assert.equal((await admin(adminRound, "PATCH", { action: "close" })).status, 200);
  assert.equal((await admin(score(id("Dani")), "PUT", { categories: ["task"] })).status, 409);
  assert.equal((await admin(adminRound, "PATCH", { action: "reopen" })).status, 200);
  assert.equal((await admin(score(id("Dani")), "PUT", { categories: ["task", "improvement"] })).status, 200);
  assert.equal((await admin(adminRound, "PATCH", { action: "close" })).status, 200);
  await stop();
  await boot();

  const reloaded = (await manager("/api/state")).body;
  assert.equal(reloaded.viewer.player.alias, "Dani");
  assert.equal(reloaded.rounds[0].status, "closed");
  assert.equal(reloaded.rounds[0].challenge, "Un juego para compartir.");
  assert.equal(reloaded.standings[0].total, 9);
  assert.equal((await manager("/api/logout", "POST", {})).status, 200);
  assert.equal((await manager("/api/state")).body.viewer, null);
  assert.equal((await manager("/api/login", "POST", { alias: "dani", password })).status, 200);
});
