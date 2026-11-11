import assert from "node:assert/strict";
import test from "node:test";
import { calculateStandings, contributionMask, lineupProblem, nextRoundStatus, pointsFor } from "../src/league.mjs";

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

test("los fichajes son dos personas distintas y al menos una es de otra sección", () => {
  const [manager, sameSection, otherSection] = players;
  assert.equal(lineupProblem(manager, sameSection, otherSection), null);
  assert.match(lineupProblem(manager, manager, otherSection), /primer puesto/);
  assert.match(lineupProblem(manager, otherSection, otherSection), /distintos/);
  assert.match(lineupProblem(manager, sameSection, { id: 5, sectionId: 1 }), /otra sección/);
  assert.match(lineupProblem(manager, sameSection, null), /dos scouters/);
});

test("la clasificación suma los puntos propios de los fichajes y aplica el desempate", () => {
  const rounds = [{ id: 1, status: "closed" }, { id: 2, status: "planned" }];
  const scores = [
    { roundId: 1, playerId: 1, mask: contributionMask(["task", "help"]) },
    { roundId: 1, playerId: 2, mask: contributionMask(["help"]) },
    { roundId: 1, playerId: 3, mask: contributionMask(["task"]) },
    { roundId: 1, playerId: 4, mask: contributionMask(["help"]) },
  ];
  const lineups = [
    { roundId: 1, playerId: 1, firstPickId: 3, secondPickId: 2 },
    { roundId: 1, playerId: 2, firstPickId: 1, secondPickId: 3 },
    { roundId: 1, playerId: 4, firstPickId: 1, secondPickId: 3 },
  ];
  const rows = calculateStandings(players, rounds, scores, lineups);
  assert.deepEqual(rows.map(({ id, rank, own, total }) => [id, rank, own, total]), [
    [1, 1, 5, 10], [2, 2, 2, 10], [4, 2, 2, 10], [3, 4, 3, 3],
  ]);
  assert.deepEqual(rows[0].results[0], { roundId: 1, own: 5, picks: 5, total: 10, scored: true });
  assert.equal(rows[0].results[1].scored, false);
});

test("la jornada bloquea los fichajes antes de cargar puntos y permite correcciones", () => {
  assert.equal(nextRoundStatus("planned", "open"), "open");
  assert.equal(nextRoundStatus("open", "lock"), "scoring");
  assert.equal(nextRoundStatus("scoring", "close"), "closed");
  assert.equal(nextRoundStatus("closed", "reopen"), "scoring");
  assert.equal(nextRoundStatus("closed", "open"), null);
  assert.equal(nextRoundStatus("open", "close"), null);
});
