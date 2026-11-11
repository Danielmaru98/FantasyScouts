import assert from "node:assert/strict";
import test from "node:test";
import { calculateStandings, contributionMask, leagueView, nextRoundStatus, pointsFor, rosterProblem } from "../src/league.mjs";

const players = [
  { id: 1, alias: "Norte", team: "Mapas", sectionId: 1 },
  { id: 2, alias: "Sur", team: "Brújulas", sectionId: 1 },
  { id: 3, alias: "Este", team: "Faroles", sectionId: 2 },
  { id: 4, alias: "Oeste", team: "Rutas", sectionId: 2 },
];

test("cada aportación puntúa como máximo una vez", () => {
  assert.equal(pointsFor(contributionMask(["task", "task", "help", "challenge", "improvement"])), 8);
  assert.equal(pointsFor(contributionMask([])), 0);
  assert.equal(contributionMask(["desconocida"]), null);
});

test("la plantilla admite monitores de cualquier sección hasta el límite configurado", () => {
  const monitors = [{ id: 1, sectionId: 1 }, { id: 2, sectionId: 1 }, { id: 3, sectionId: 2 }];
  assert.equal(rosterProblem([1, 2], monitors, 2), null);
  assert.equal(rosterProblem([], monitors, 2), null);
  assert.match(rosterProblem([1, 2, 3], monitors, 2), /hasta 2/);
  assert.match(rosterProblem([3, 3], monitors, 2), /una plaza/);
  assert.match(rosterProblem([42], monitors, 2), /registrados/);
  assert.match(rosterProblem(null, monitors, 2), /Elige/);
});

test("la clasificación suma los monitores de cada equipo y asigna el mismo puesto si empatan", () => {
  const rounds = [{ id: 1, status: "closed" }, { id: 2, status: "planned" }];
  const scores = [
    { roundId: 1, monitorId: 1, mask: contributionMask(["task", "help"]) },
    { roundId: 1, monitorId: 2, mask: contributionMask(["help"]) },
    { roundId: 1, monitorId: 3, mask: contributionMask(["task"]) },
    { roundId: 1, monitorId: 4, mask: contributionMask(["help"]) },
  ];
  const roundRosters = [
    { roundId: 1, playerId: 1, monitorIds: [3, 2] },
    { roundId: 1, playerId: 2, monitorIds: [1, 3] },
    { roundId: 1, playerId: 4, monitorIds: [1, 3] },
  ];
  const rows = calculateStandings(players, rounds, scores, roundRosters);
  assert.deepEqual(rows.map(({ id, rank, total }) => [id, rank, total]), [
    [2, 1, 8], [4, 1, 8], [1, 3, 5], [3, 4, 0],
  ]);
  assert.deepEqual(rows[2].results[0], { roundId: 1, total: 5, scored: true });
  assert.equal(rows[0].results[1].scored, false);
});

test("la semana fija las plantillas antes de cargar puntos y permite correcciones", () => {
  assert.equal(nextRoundStatus("planned", "open"), "open");
  assert.equal(nextRoundStatus("open", "lock"), "scoring");
  assert.equal(nextRoundStatus("scoring", "close"), "closed");
  assert.equal(nextRoundStatus("closed", "reopen"), "scoring");
  assert.equal(nextRoundStatus("closed", "open"), null);
  assert.equal(nextRoundStatus("open", "close"), null);
});

test("el mercado acumula las jornadas cerradas y aplica el ajuste de fichajes actuales una vez", () => {
  const teams = Array.from({ length: 6 }, (_, index) => {
    const id = index + 1;
    return { id, alias: `Mánager ${id}`, team: `Equipo ${id}`, sectionId: 1 };
  });
  const snapshot = {
    sections: [{ id: 1, name: "Tropa Jungla", reviewerId: null }],
    players: teams,
    monitors: ["Norte", "Junco", "Pino"].map((name, index) =>
      ({ id: index + 1, name, sectionId: 1, marketValueCents: 100_000 })),
    rounds: [{ id: 2, status: "closed" }, { id: 1, status: "closed" }, { id: 3, status: "scoring" }],
    rosterSize: 5,
    rosters: teams.map(({ id }) => ({ playerId: id, monitorIds: id === 1 ? [1, 2] : [1] })),
    roundRosters: teams.map(({ id }) => ({ roundId: 1, playerId: id, monitorIds: id === 1 ? [1, 3] : [1] })),
    scores: [
      { roundId: 1, monitorId: 1, mask: contributionMask(["task", "help", "challenge", "improvement"]) },
      { roundId: 2, monitorId: 1, mask: contributionMask([]) },
      { roundId: 3, monitorId: 2, mask: contributionMask(["task", "help", "challenge", "improvement"]) },
    ],
  };
  const read = () => leagueView(snapshot, { isAdmin: true, playerId: null });
  const view = read();
  assert.equal(view.marketRoundId, 2);
  assert.deepEqual(view.monitors.map(({ marketValueCents, currentValueCents, signedTeams, alignedTeams }) =>
    [marketValueCents, currentValueCents, signedTeams, alignedTeams]), [
    [100_000, 109_158, 6, 0],
    [100_000, 101_000, 1, 0],
    [100_000, 93_000, 0, 0],
  ]);

  snapshot.rounds[0].status = "scoring";
  const reopened = read();
  assert.equal(reopened.marketRoundId, 1);
  assert.equal(reopened.monitors[0].currentValueCents, 118_650);
  assert.equal(reopened.monitors[0].alignedTeams, 6);

  snapshot.scores[1].mask = contributionMask(["task", "help"]);
  snapshot.rounds[0].status = "closed";
  const corrected = read();
  assert.equal(corrected.monitors[0].currentValueCents, 121_023);
  assert.deepEqual(read().monitors, corrected.monitors);
});
