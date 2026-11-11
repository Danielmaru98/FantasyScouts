import { calculateStandings, contributionMask, CONTRIBUTIONS, lineupProblem, nextRoundStatus, STARTER_CHALLENGES } from "./league.mjs";

const LOCAL_KEY = "fantasyscout-108-local-v1";
const LOCAL_FORMAT = "fantasyscout-108";
const LOCAL_STATUSES = new Set(["planned", "open", "scoring", "closed"]);
const UNSAVED = "El navegador limita el guardado local. Descarga una copia desde Gestión para conservar esta sesión.";
const UNREADABLE = "La liga guardada no se pudo leer. Puedes recuperar los datos importando una copia desde Gestión.";
const localKey = (value) => value.normalize("NFKC").toLocaleLowerCase("es");
const validLocalId = (value) => Number.isSafeInteger(value) && value > 0;
const hasUnique = (rows, key) => new Set(rows.map(key)).size === rows.length;
const localEntryKey = ({ roundId, playerId }) => `${roundId}/${playerId}`;

function localError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function localText(value, label, max, optional = false) {
  const text = typeof value === "string" ? value.trim().normalize("NFC") : "";
  if (typeof value !== "string" || (!text && !optional) || text.length > max || text.includes("\0")) {
    throw localError(`Revisa ${label}. El máximo es de ${max} caracteres.`);
  }
  return text;
}

function localDate(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw localError("Introduce una fecha válida.");
  }
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw localError("Introduce una fecha válida.");
  }
  return value;
}

function newLocalLeague() {
  return {
    format: LOCAL_FORMAT,
    version: 1,
    sections: [{ id: 1, name: "Tropa Jungla", reviewerId: null }],
    players: [],
    rounds: STARTER_CHALLENGES.map((challenge, index) => ({ id: index + 1, challenge, date: null, status: "planned" })),
    lineups: [],
    scores: [],
  };
}

function normalizeCopy(serialized) {
  const invalid = () => localError("El archivo no contiene una copia válida de FantasyScout.");
  let data;
  try {
    data = JSON.parse(serialized);
  } catch {
    throw invalid();
  }
  if (data?.format !== LOCAL_FORMAT || data.version !== 1 ||
      !["sections", "players", "rounds", "lineups", "scores"].every((name) =>
        Array.isArray(data[name]) && data[name].every((row) => row && typeof row === "object"))) {
    throw invalid();
  }

  const sections = data.sections.map(({ id, name, reviewerId }) => ({
    id, name: localText(name, "el nombre de la sección", 60), reviewerId,
  }));
  const players = data.players.map(({ id, alias, team, sectionId }) => ({
    id, alias: localText(alias, "el alias", 32), team: localText(team, "el nombre del equipo", 52), sectionId,
  }));
  const rounds = data.rounds.map(({ id, challenge, date, status }) => ({
    id, challenge: localText(challenge, "el reto", 280), date: localDate(date), status,
  })).sort((a, b) => a.id - b.id);
  const lineups = data.lineups.map(({ roundId, playerId, firstPickId, secondPickId }) =>
    ({ roundId, playerId, firstPickId, secondPickId }));
  const scores = data.scores.map(({ roundId, playerId, mask, note }) =>
    ({ roundId, playerId, mask, note: localText(note, "la nota", 280, true) }));
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const playerById = new Map(players.map((player) => [player.id, player]));
  const roundById = new Map(rounds.map((round) => [round.id, round]));

  if (!sections.length || !hasUnique(sections, ({ name }) => localKey(name)) ||
      sectionById.size !== sections.length || !sections.every(({ id, reviewerId }) =>
        validLocalId(id) && (reviewerId === null || playerById.get(reviewerId)?.sectionId === id)) ||
      playerById.size !== players.length || !hasUnique(players, ({ alias }) => localKey(alias)) ||
      !players.every(({ id, sectionId }) => validLocalId(id) && sectionById.has(sectionId)) ||
      rounds.length !== STARTER_CHALLENGES.length ||
      !rounds.every(({ id, status }, index) => id === index + 1 && LOCAL_STATUSES.has(status))) {
    throw invalid();
  }
  if (!hasUnique(lineups, localEntryKey) || !lineups.every(({ roundId, playerId, firstPickId, secondPickId }) => {
    const manager = playerById.get(playerId);
    const round = roundById.get(roundId);
    return manager && round && round.status !== "planned" &&
      !lineupProblem(manager, playerById.get(firstPickId), playerById.get(secondPickId));
  })) throw invalid();
  if (!hasUnique(scores, localEntryKey) || !scores.every(({ roundId, playerId, mask }) =>
    playerById.has(playerId) && ["scoring", "closed"].includes(roundById.get(roundId)?.status) &&
    Number.isInteger(mask) && mask >= 0 && mask < 2 ** CONTRIBUTIONS.length)) throw invalid();

  return { format: LOCAL_FORMAT, version: 1, sections, players, rounds, lineups, scores };
}

function saveLocalEntry(rows, entry) {
  const index = rows.findIndex(({ roundId, playerId }) => roundId === entry.roundId && playerId === entry.playerId);
  if (index === -1) rows.push(entry);
  else rows[index] = entry;
}

function addLocalId(rows) {
  const id = rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1;
  if (!validLocalId(id)) throw localError("La copia no admite más registros.");
  return id;
}

export function createOfflineLeague({ storage = null, locks = null } = {}) {
  let activeId = null;
  let data = newLocalLeague();
  let lastStored = null;
  let warning = storage ? "" : UNSAVED;

  function read() {
    if (!storage) return data;
    let stored;
    try {
      stored = storage.getItem(LOCAL_KEY);
    } catch {
      storage = null;
      warning = UNSAVED;
      return data;
    }
    if (stored === lastStored) return data;
    lastStored = stored;
    try {
      data = stored === null ? newLocalLeague() : normalizeCopy(stored);
      warning = "";
    } catch {
      warning = UNREADABLE;
    }
    return data;
  }

  function write(next) {
    data = next;
    if (!storage) return;
    const serialized = JSON.stringify(next);
    try {
      storage.setItem(LOCAL_KEY, serialized);
      lastStored = serialized;
      warning = "";
    } catch {
      storage = null;
      warning = UNSAVED;
    }
  }

  function actorFor(snapshot) {
    return snapshot.players.find(({ id }) => id === activeId) ?? null;
  }

  function stateFor() {
    const snapshot = read();
    const { sections, players, rounds, scores, lineups } = snapshot;
    const actor = actorFor(snapshot);
    const reviewIds = sections.filter((section) => !actor || section.reviewerId === actor.id).map(({ id }) => id);
    const sectionIds = new Map(players.map(({ id, sectionId }) => [id, sectionId]));
    const reviewed = new Set(reviewIds);
    return {
      viewer: actor ? { role: "player", player: actor, reviewIds } : { role: "admin", reviewIds },
      sections,
      players,
      rounds,
      contributions: CONTRIBUTIONS,
      standings: calculateStandings(players, rounds, scores, lineups),
      lineups: lineups.filter(({ playerId }) => playerId === actor?.id),
      reviewScores: scores.filter(({ playerId }) => reviewed.has(sectionIds.get(playerId))),
      storageWarning: warning,
    };
  }

  function edit(path, method, body, draft, actor) {
    const route = path.split("/").slice(2);
    const lookupPlayer = (id) => draft.players.find((player) => player.id === id);
    const lookupSection = (id) => draft.sections.find((section) => section.id === id);
    const lookupRound = (id) => {
      const round = draft.rounds.find((entry) => entry.id === id);
      if (!round) throw localError("La jornada no existe.", 404);
      return round;
    };

    if (route[0] === "admin") {
      if (actor) throw localError("Selecciona la vista Organización para hacer este cambio.", 403);
      const id = Number(route[2]);
      if (route[1] === "players" && method === "POST") {
        const alias = localText(body.alias, "el alias", 32);
        const team = localText(body.team, "el nombre del equipo", 52);
        if (!lookupSection(body.sectionId)) throw localError("Elige una sección de la liga.");
        if (draft.players.some((player) => localKey(player.alias) === localKey(alias))) {
          throw localError("Ese alias ya está inscrito. Prueba con otro.", 409);
        }
        draft.players.push({ id: addLocalId(draft.players), alias, team, sectionId: body.sectionId });
        return;
      }
      if (route[1] === "sections" && ["POST", "PATCH"].includes(method)) {
        const section = method === "PATCH" ? lookupSection(id) : null;
        if (method === "PATCH" && !section) throw localError("La sección no existe.", 404);
        const name = localText(body.name ?? section?.name, "el nombre de la sección", 60);
        if (draft.sections.some((entry) => entry.id !== section?.id && localKey(entry.name) === localKey(name))) {
          throw localError("Esa sección ya está inscrita.", 409);
        }
        const reviewerId = body.reviewerId === undefined ? section?.reviewerId ?? null : body.reviewerId;
        if (reviewerId !== null && (!section || lookupPlayer(reviewerId)?.sectionId !== section.id)) {
          throw localError("Elige a un scouter inscrito en esta sección.");
        }
        if (section) Object.assign(section, { name, reviewerId });
        else draft.sections.push({ id: addLocalId(draft.sections), name, reviewerId });
        return;
      }
      if (route[1] === "rounds" && method === "PATCH") {
        const round = lookupRound(id);
        if ("challenge" in body) round.challenge = localText(body.challenge, "el reto", 280);
        if ("date" in body) round.date = localDate(body.date);
        if ("action" in body) {
          const status = nextRoundStatus(round.status, body.action);
          if (!status) throw localError("La jornada cambió de estado. Actualiza la página.", 409);
          round.status = status;
        }
        return;
      }
    }

    if (route[0] === "rounds" && method === "PUT") {
      const round = lookupRound(Number(route[1]));
      if (route[2] === "lineup") {
        if (!actor) throw localError("Selecciona la vista del scouter para guardar su alineación.", 403);
        if (round.status !== "open") throw localError("Los fichajes de esta jornada están cerrados.", 409);
        const problem = lineupProblem(actor, lookupPlayer(body.firstPickId), lookupPlayer(body.secondPickId));
        if (problem) throw localError(problem);
        saveLocalEntry(draft.lineups, {
          roundId: round.id, playerId: actor.id, firstPickId: body.firstPickId, secondPickId: body.secondPickId,
        });
        return;
      }
      if (route[2] === "scores") {
        const target = lookupPlayer(Number(route[3]));
        if (!target) throw localError("El scouter no existe.", 404);
        if (actor && lookupSection(target.sectionId)?.reviewerId !== actor.id) {
          throw localError("Solo puedes puntuar en la sección que tienes asignada.", 403);
        }
        if (round.status !== "scoring") throw localError("La jornada debe estar en fase de puntuación.", 409);
        const mask = contributionMask(body.categories);
        if (mask === null) throw localError("Revisa las aportaciones seleccionadas.");
        const note = localText(body.note ?? "", "la nota de aportaciones", 280, true);
        saveLocalEntry(draft.scores, { roundId: round.id, playerId: target.id, mask, note });
        return;
      }
    }
    throw localError("Acción no disponible en la liga local.", 404);
  }

  async function serializedWrite(work) {
    if (!locks?.request) return work();
    let acquired = false;
    try {
      return await locks.request(LOCAL_KEY, () => {
        acquired = true;
        return work();
      });
    } catch (error) {
      if (acquired) throw error;
      return work();
    }
  }

  return {
    async request(path, method, body) {
      if (path === "/api/state" && method === "GET") return stateFor();
      await serializedWrite(() => {
        const draft = JSON.parse(JSON.stringify(read()));
        edit(path, method, body, draft, actorFor(draft));
        write(draft);
      });
      return { ok: true };
    },
    viewAs(id) {
      if (id !== null && !read().players.some((player) => player.id === id)) throw localError("Elige un scouter inscrito.");
      activeId = id;
    },
    exportBackup() {
      return JSON.stringify(read(), null, 2);
    },
    async importBackup(serialized) {
      const next = normalizeCopy(serialized);
      await serializedWrite(() => write(next));
      activeId = null;
    },
  };
}
