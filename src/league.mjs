export const CONTRIBUTIONS = [
  { id: "task", label: "Tarea acordada", points: 3, description: "Preparar una actividad, coordinar una salida o dejar listo el material." },
  { id: "help", label: "Apoyo", points: 2, description: "Ayudar a otro monitor con una tarea concreta." },
  { id: "challenge", label: "Reto común", points: 2, description: "Completar el reto anunciado para la semana." },
  { id: "improvement", label: "Mejora", points: 1, description: "Proponer una mejora que el equipo ponga en práctica." },
];

export const STARTER_CHALLENGES = [
  "Dejar por escrito un juego breve que otra sección pueda adaptar.",
  "Preparar una variante de una actividad para un día de lluvia.",
  "Adaptar un juego para que alguien que se incorpora por primera vez pueda participar.",
  "Probar una dinámica prestada de otra sección y contarle cómo salió.",
];

export const DEFAULT_ROSTER_SIZE = 5;
export const MAX_ROSTER_SIZE = 30;
export const DEFAULT_MARKET_VALUE_CENTS = 100_000;
export const MARKET_VALUE_ERROR = "Introduce un valor en euros igual o superior a cero, con hasta dos decimales.";

export function validRosterSize(size) {
  return Number.isInteger(size) && size >= 1 && size <= MAX_ROSTER_SIZE;
}

export function validMarketValue(cents) {
  return Number.isSafeInteger(cents) && cents >= 0;
}

export function contributionMask(categories) {
  if (!Array.isArray(categories)) return null;

  let mask = 0;
  for (const category of categories) {
    const index = CONTRIBUTIONS.findIndex(({ id }) => id === category);
    if (index < 0) return null;
    mask |= 1 << index;
  }
  return mask;
}

export function pointsFor(mask) {
  return CONTRIBUTIONS.reduce((points, category, index) => {
    return points + (mask & (1 << index) ? category.points : 0);
  }, 0);
}

export function rosterProblem(monitorIds, monitors, size) {
  if (!Array.isArray(monitorIds)) return "Elige los monitores de tu equipo.";
  if (monitorIds.length > size) return `Tu plantilla admite hasta ${size} monitores.`;
  if (new Set(monitorIds).size !== monitorIds.length) return "Cada monitor ocupa una plaza en tu equipo.";
  const available = new Set(monitors.map(({ id }) => id));
  if (!monitorIds.every((id) => available.has(id))) return "Selecciona monitores registrados en la liga.";
  return null;
}

export function rosterAfterTransfer(currentIds, monitors, size, monitorId, action) {
  if (action !== "sign" && action !== "release") return { problem: "Elige fichar o liberar al monitor." };
  if (!monitors.some(({ id }) => id === monitorId)) return { problem: "El monitor no está registrado en la liga." };
  const monitorIds = action === "sign"
    ? [...new Set([...currentIds, monitorId])]
    : currentIds.filter((id) => id !== monitorId);
  return { monitorIds, problem: rosterProblem(monitorIds, monitors, size) };
}

const TRANSITIONS = {
  open: { from: "planned", to: "open" },
  lock: { from: "open", to: "scoring" },
  close: { from: "scoring", to: "closed" },
  reopen: { from: "closed", to: "scoring" },
};

export function nextRoundStatus(status, action) {
  const transition = Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action] : null;
  if (!transition || (transition.from !== status && transition.to !== status)) return null;
  return transition.to;
}

function indexByRound(rounds, entries, key, valueFor) {
  const index = new Map(rounds.map(({ id }) => [id, new Map()]));
  for (const entry of entries) {
    index.get(entry.roundId)?.set(entry[key], valueFor(entry));
  }
  return index;
}

export function calculateStandings(players, rounds, scores, roundRosters) {
  const pointsByRound = indexByRound(rounds, scores, "monitorId", ({ mask }) => pointsFor(mask));
  const rostersByRound = indexByRound(rounds, roundRosters, "playerId", ({ monitorIds }) => monitorIds);
  const rows = players.map(({ id, alias, team, sectionId }) => {
    let total = 0;
    const results = rounds.map((round) => {
      const points = pointsByRound.get(round.id);
      const members = rostersByRound.get(round.id).get(id) ?? [];
      const weekly = members.reduce((sum, monitorId) => sum + (points.get(monitorId) ?? 0), 0);
      total += weekly;
      return {
        roundId: round.id,
        total: weekly,
        scored: points.size > 0 || round.status === "closed",
      };
    });
    return { id, alias, team, sectionId, total, results };
  });

  rows.sort((a, b) => b.total - a.total ||
    a.team.localeCompare(b.team, "es") || a.alias.localeCompare(b.alias, "es") || a.id - b.id);

  let rank = 0;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    if (!previous || row.total !== previous.total) rank = index + 1;
    return { ...row, rank };
  });
}

export function convertLegacyGame({ players, rounds, lineups, scores }) {
  const latest = new Map();
  const frozen = new Set(rounds.filter(({ status }) => status === "scoring" || status === "closed").map(({ id }) => id));
  const roundRosters = [];
  for (const { playerId, roundId, firstPickId, secondPickId } of [...lineups].sort((a, b) => a.roundId - b.roundId)) {
    const monitorIds = [firstPickId, secondPickId];
    latest.set(playerId, { playerId, monitorIds });
    if (frozen.has(roundId)) roundRosters.push({ roundId, playerId, monitorIds });
  }
  return {
    monitors: players.map(({ id, alias, sectionId }) => ({ id, name: alias, sectionId })),
    rosterSize: DEFAULT_ROSTER_SIZE,
    rosters: [...latest.values()],
    roundRosters,
    scores: scores.map(({ playerId, ...score }) => ({ ...score, monitorId: playerId })),
  };
}

export function leagueView(snapshot, actor) {
  const { sections, players, monitors, rounds, rosterSize, rosters, roundRosters, scores } = snapshot;
  const publicSections = sections.map(({ id, name }) => ({ id, name }));
  const player = actor && players.find(({ id }) => id === actor.playerId);
  if (!actor || (!actor.isAdmin && !player)) return { viewer: null, sections: publicSections };

  const reviewIds = sections.filter(({ id, reviewerId }) => actor.isAdmin || reviewerId === player?.id)
    .map(({ id }) => id);
  const reviewable = new Set(reviewIds);
  const monitorSections = new Map(monitors.map(({ id, sectionId }) => [id, sectionId]));
  const viewer = actor.isAdmin ? { role: "admin", reviewIds } : { role: "player", player, reviewIds };
  return {
    viewer,
    sections: actor.isAdmin ? sections : publicSections,
    players,
    monitors,
    defaultMarketValueCents: DEFAULT_MARKET_VALUE_CENTS,
    rounds,
    rosterSize,
    rosterLimit: MAX_ROSTER_SIZE,
    contributions: CONTRIBUTIONS,
    standings: calculateStandings(players, rounds, scores, roundRosters),
    roster: rosters.find(({ playerId }) => playerId === player?.id)?.monitorIds ?? [],
    weeklyRosters: roundRosters.filter(({ playerId }) => playerId === player?.id),
    monitorPoints: scores.map(({ roundId, monitorId, mask }) => ({ roundId, monitorId, points: pointsFor(mask) })),
    reviewScores: scores.filter(({ monitorId }) => reviewable.has(monitorSections.get(monitorId))),
  };
}
