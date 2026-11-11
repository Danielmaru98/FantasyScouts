export const CONTRIBUTIONS = [
  { id: "task", label: "Tarea acordada", points: 3, description: "Preparar una actividad, coordinar una salida o dejar listo el material." },
  { id: "help", label: "Apoyo", points: 2, description: "Ayudar a otro scouter con una tarea concreta." },
  { id: "challenge", label: "Reto común", points: 2, description: "Completar el reto anunciado para la jornada." },
  { id: "improvement", label: "Mejora", points: 1, description: "Proponer una mejora que el equipo ponga en práctica." },
];

export const STARTER_CHALLENGES = [
  "Dejar por escrito un juego breve que otra sección pueda adaptar.",
  "Preparar una variante de una actividad para un día de lluvia.",
  "Adaptar un juego para que alguien que se incorpora por primera vez pueda participar.",
  "Probar una dinámica prestada de otra sección y contarle cómo salió.",
];

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

export function lineupProblem(manager, firstPick, secondPick) {
  if (!firstPick || !secondPick) return "Elige dos scouters inscritos.";
  if (firstPick.id === secondPick.id) return "Elige dos fichajes distintos.";
  if (firstPick.id === manager.id || secondPick.id === manager.id) {
    return "Ya ocupas el primer puesto de tu alineación.";
  }
  if (firstPick.sectionId === manager.sectionId && secondPick.sectionId === manager.sectionId) {
    return "Al menos un fichaje debe ser de otra sección.";
  }
  return null;
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

function indexByRound(rounds, entries, valueFor) {
  const index = new Map(rounds.map(({ id }) => [id, new Map()]));
  for (const entry of entries) {
    index.get(entry.roundId)?.set(entry.playerId, valueFor(entry));
  }
  return index;
}

export function calculateStandings(players, rounds, scores, lineups) {
  const pointsByRound = indexByRound(rounds, scores, ({ mask }) => pointsFor(mask));
  const lineupsByRound = indexByRound(rounds, lineups, (lineup) => lineup);
  const rows = players.map(({ id, alias, team, sectionId }) => {
    let own = 0;
    let total = 0;
    const results = rounds.map((round) => {
      const points = pointsByRound.get(round.id);
      const lineup = lineupsByRound.get(round.id).get(id);
      const personal = points.get(id) ?? 0;
      const picks = lineup
        ? (points.get(lineup.firstPickId) ?? 0) + (points.get(lineup.secondPickId) ?? 0)
        : 0;

      own += personal;
      total += personal + picks;
      return {
        roundId: round.id,
        own: personal,
        picks,
        total: personal + picks,
        scored: points.size > 0 || round.status === "closed",
      };
    });
    return { id, alias, team, sectionId, own, total, results };
  });

  rows.sort((a, b) => b.total - a.total || b.own - a.own ||
    a.team.localeCompare(b.team, "es") || a.alias.localeCompare(b.alias, "es") || a.id - b.id);

  let rank = 0;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    if (!previous || row.total !== previous.total || row.own !== previous.own) rank = index + 1;
    return { ...row, rank };
  });
}
