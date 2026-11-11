import assert from "node:assert/strict";
import test from "node:test";
import { calculateStandings, contributionMask, nextRoundStatus, pointsFor, rosterProblem } from "../src/league.mjs";

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
