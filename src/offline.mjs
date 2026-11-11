import {
  contributionMask, CONTRIBUTIONS, convertLegacyGame, DEFAULT_MARKET_VALUE_CENTS, DEFAULT_ROSTER_SIZE,
  leagueView, MARKET_VALUE_ERROR, MAX_ROSTER_SIZE, nextRoundStatus, rosterAfterTransfer, rosterProblem,
  STARTER_CHALLENGES, validMarketValue, validRosterSize,
} from "./league.mjs";

const LOCAL_KEY = "fantasyscout-108-local-v1";
const LOCAL_FORMAT = "fantasyscout-108";
const MONITOR_REGISTER_FORMAT = "fantasyscout-monitores";
const LOCAL_STATUSES = new Set(["planned", "open", "scoring", "closed"]);
const UNSAVED = "El navegador limita el guardado local. Abre el HTML descargado directamente en tu navegador para llevar la liga. Descarga una copia desde Monitores o Gestión para conservar los cambios de esta sesión.";
const UNREADABLE = "La liga guardada no se pudo leer. Puedes recuperar los datos importando una copia desde Gestión.";
const localKey = (value) => value.normalize("NFKC").toLocaleLowerCase("es");
const validLocalId = (value) => Number.isSafeInteger(value) && value > 0;
const hasUnique = (rows, key) => new Set(rows.map(key)).size === rows.length;
const weeklyRosterKey = ({ roundId, playerId }) => `${roundId}/${playerId}`;
const weeklyScoreKey = ({ roundId, monitorId }) => `${roundId}/${monitorId}`;
const isFixed = (status) => status === "scoring" || status === "closed";

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
    version: 2,
    sections: [{ id: 1, name: "Tropa Jungla", reviewerId: null }],
    players: [],
    rounds: STARTER_CHALLENGES.map((challenge, index) => ({ id: index + 1, challenge, date: null, status: "planned" })),
    monitors: [],
    rosterSize: DEFAULT_ROSTER_SIZE,
    rosters: [],
    roundRosters: [],
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
  if (data?.format !== LOCAL_FORMAT || ![1, 2].includes(data.version)) throw invalid();
  const gameLists = data.version === 1 ? ["lineups"] : ["monitors", "rosters", "roundRosters"];
  if (!["sections", "players", "rounds", "scores", ...gameLists].every((name) =>
        Array.isArray(data[name]) && data[name].every((row) => row && typeof row === "object"))) {
    throw invalid();
  }
  if (data.version === 1) data = { ...data, ...convertLegacyGame(data), version: 2 };

  const sections = data.sections.map(({ id, name, reviewerId }) => ({
    id, name: localText(name, "el nombre de la sección", 60), reviewerId,
  }));
  const players = data.players.map(({ id, alias, team, sectionId }) => ({
    id, alias: localText(alias, "el alias", 32), team: localText(team, "el nombre del equipo", 52), sectionId,
  }));
  const rounds = data.rounds.map(({ id, challenge, date, status }) => ({
    id, challenge: localText(challenge, "el reto", 280, true), date: localDate(date), status,
  })).sort((a, b) => a.id - b.id);
  const monitors = data.monitors.map(({ id, name, sectionId, marketValueCents = DEFAULT_MARKET_VALUE_CENTS }) => ({
    id, name: localText(name, "el nombre del monitor", 60), sectionId, marketValueCents,
  }));
  const rosterSize = data.rosterSize;
  const rosters = data.rosters.map(({ playerId, monitorIds }) => ({ playerId, monitorIds }));
  const roundRosters = data.roundRosters.map(({ roundId, playerId, monitorIds }) => ({ roundId, playerId, monitorIds }));
  const scores = data.scores.map(({ roundId, monitorId, mask, note }) =>
    ({ roundId, monitorId, mask, note: localText(note, "la nota", 280, true) }));
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const playerById = new Map(players.map((player) => [player.id, player]));
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]));

  if (!sections.length || !hasUnique(sections, ({ name }) => localKey(name)) ||
      sectionById.size !== sections.length || !sections.every(({ id, reviewerId }) =>
        validLocalId(id) && (reviewerId === null || playerById.get(reviewerId)?.sectionId === id)) ||
      playerById.size !== players.length || !hasUnique(players, ({ alias }) => localKey(alias)) ||
      !players.every(({ id, sectionId }) => validLocalId(id) && sectionById.has(sectionId)) ||
      monitorById.size !== monitors.length ||
      !hasUnique(monitors, ({ name, sectionId }) => `${sectionId}/${localKey(name)}`) ||
      !monitors.every(({ id, sectionId, marketValueCents }) =>
        validLocalId(id) && sectionById.has(sectionId) && validMarketValue(marketValueCents)) ||
      !validRosterSize(rosterSize) || !rounds.length ||
      !rounds.every(({ id, status }, index) => id === index + 1 && LOCAL_STATUSES.has(status))) {
    throw invalid();
  }
  if (!hasUnique(rosters, ({ playerId }) => playerId) || !rosters.every(({ playerId, monitorIds }) =>
    playerById.has(playerId) && !rosterProblem(monitorIds, monitors, rosterSize))) throw invalid();
  if (!hasUnique(roundRosters, weeklyRosterKey) || !roundRosters.every(({ roundId, playerId, monitorIds }) =>
    isFixed(roundById.get(roundId)?.status) && playerById.has(playerId) &&
    !rosterProblem(monitorIds, monitors, MAX_ROSTER_SIZE))) throw invalid();
  if (!hasUnique(scores, weeklyScoreKey) || !scores.every(({ roundId, monitorId, mask }) =>
    monitorById.has(monitorId) && isFixed(roundById.get(roundId)?.status) &&
    Number.isInteger(mask) && mask >= 0 && mask < 2 ** CONTRIBUTIONS.length)) throw invalid();

  return { format: LOCAL_FORMAT, version: 2, sections, players, monitors, rounds, rosterSize, rosters, roundRosters, scores };
}

function saveLocalEntry(rows, entry, key) {
  const index = rows.findIndex((row) => key(row) === key(entry));
  if (index === -1) rows.push(entry);
  else rows[index] = entry;
}

function addLocalId(rows) {
  const id = rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1;
  if (!validLocalId(id)) throw localError("La copia no admite más registros.");
  return id;
}

function addMonitorTo(snapshot, name, sectionId, marketValueCents) {
  if (snapshot.monitors.some((monitor) => monitor.sectionId === sectionId && localKey(monitor.name) === localKey(name))) {
    return false;
  }
  snapshot.monitors.push({ id: addLocalId(snapshot.monitors), name, sectionId, marketValueCents });
  return true;
}

function monitorRegisterRows(snapshot) {
  const sections = new Map(snapshot.sections.map(({ id, name }) => [id, name]));
  return snapshot.monitors.map(({ name, sectionId, marketValueCents }) =>
    ({ name, section: sections.get(sectionId), marketValueCents }));
}

function readMonitorRegister(serialized) {
  const invalid = () => localError("Elige un registro de monitores o una copia válida de FantasyScout.");
  let copy;
  try {
    copy = JSON.parse(serialized);
  } catch {
    throw invalid();
  }
  if (copy?.format === LOCAL_FORMAT) return monitorRegisterRows(normalizeCopy(serialized));
  if (copy?.format !== MONITOR_REGISTER_FORMAT || copy.version !== 1 ||
      !Array.isArray(copy.monitors) || copy.monitors.some((row) => !row || typeof row !== "object")) {
    throw invalid();
  }
  return copy.monitors.map(({ name, section, marketValueCents = DEFAULT_MARKET_VALUE_CENTS }) => {
    if (!validMarketValue(marketValueCents)) throw invalid();
    return {
      name: localText(name, "el nombre del monitor", 60),
      section: localText(section, "el nombre de la sección", 60),
      marketValueCents,
    };
  });
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
      if (storage.getItem(LOCAL_KEY) !== serialized) throw new Error("No se pudo verificar el guardado.");
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
    const actor = actorFor(snapshot);
    return {
      ...leagueView(snapshot, { isAdmin: !actor, playerId: actor?.id ?? null }),
      storageWarning: warning,
    };
  }

  function edit(path, method, body, draft, actor) {
    const route = path.split("/").slice(2);
    const lookupPlayer = (id) => draft.players.find((player) => player.id === id);
    const lookupSection = (id) => draft.sections.find((section) => section.id === id);
    const lookupRound = (id) => {
      const round = draft.rounds.find((entry) => entry.id === id);
      if (!round) throw localError("La semana no existe.", 404);
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
          throw localError("Elige a un mánager de esta sección.");
        }
        if (section) Object.assign(section, { name, reviewerId });
        else draft.sections.push({ id: addLocalId(draft.sections), name, reviewerId });
        return;
      }
      if (route[1] === "monitors" && method === "POST") {
        const name = localText(body.name, "el nombre del monitor", 60);
        const { sectionId, marketValueCents = DEFAULT_MARKET_VALUE_CENTS } = body;
        if (!lookupSection(sectionId)) throw localError("Elige una sección de la liga.");
        if (!validMarketValue(marketValueCents)) throw localError(MARKET_VALUE_ERROR);
        if (!addMonitorTo(draft, name, sectionId, marketValueCents)) {
          throw localError("Ese monitor ya está registrado en esta sección.", 409);
        }
        return;
      }
      if (route[1] === "monitors" && method === "PATCH") {
        const monitor = draft.monitors.find((entry) => entry.id === id);
        if (!monitor) throw localError("El monitor no existe.", 404);
        if (!validMarketValue(body.marketValueCents)) throw localError(MARKET_VALUE_ERROR);
        monitor.marketValueCents = body.marketValueCents;
        return;
      }
      if (route[1] === "settings" && method === "PATCH") {
        const size = body.rosterSize;
        if (!validRosterSize(size)) throw localError(`Elige un límite entre 1 y ${MAX_ROSTER_SIZE} monitores.`);
        if (draft.rosters.some(({ monitorIds }) => monitorIds.length > size)) {
          throw localError("Reduce las plantillas que superen el nuevo límite antes de guardarlo.", 409);
        }
        draft.rosterSize = size;
        return;
      }
      if (route[1] === "rounds" && method === "POST") {
        const challenge = localText(body.challenge ?? "", "el reto", 280, true);
        const date = localDate(body.date ?? null);
        draft.rounds.push({ id: addLocalId(draft.rounds), challenge, date, status: "planned" });
        return;
      }
      if (route[1] === "rounds" && method === "PATCH") {
        const round = lookupRound(id);
        if ("challenge" in body) round.challenge = localText(body.challenge, "el reto", 280, true);
        if ("date" in body) round.date = localDate(body.date);
        if ("action" in body) {
          const status = nextRoundStatus(round.status, body.action);
          if (!status) throw localError("La semana cambió de estado. Actualiza la página.", 409);
          if (round.status === "open" && status === "scoring") {
            for (const { playerId, monitorIds } of draft.rosters) {
              draft.roundRosters.push({ roundId: round.id, playerId, monitorIds: [...monitorIds] });
            }
          }
          round.status = status;
        }
        return;
      }
    }

    if (route[0] === "roster" && ["PUT", "PATCH"].includes(method)) {
      if (!actor) throw localError("Selecciona la vista de un mánager para guardar su plantilla.", 403);
      const currentIds = draft.rosters.find(({ playerId }) => playerId === actor.id)?.monitorIds ?? [];
      const { monitorIds, problem } = method === "PATCH"
        ? rosterAfterTransfer(currentIds, draft.monitors, draft.rosterSize, body.monitorId, body.action)
        : { monitorIds: body.monitorIds, problem: rosterProblem(body.monitorIds, draft.monitors, draft.rosterSize) };
      if (problem) throw localError(problem);
      saveLocalEntry(draft.rosters, { playerId: actor.id, monitorIds: [...monitorIds] }, ({ playerId }) => playerId);
      return;
    }

    if (route[0] === "rounds" && route[2] === "scores" && method === "PUT") {
      const round = lookupRound(Number(route[1]));
      const target = draft.monitors.find(({ id }) => id === Number(route[3]));
      if (!target) throw localError("El monitor no existe.", 404);
      if (actor && lookupSection(target.sectionId)?.reviewerId !== actor.id) {
        throw localError("Solo puedes puntuar en la sección que tienes asignada.", 403);
      }
      if (round.status !== "scoring") throw localError("La semana debe estar en fase de puntuación.", 409);
      const mask = contributionMask(body.categories);
      if (mask === null) throw localError("Revisa las aportaciones seleccionadas.");
      const note = localText(body.note ?? "", "la nota de aportaciones", 280, true);
      saveLocalEntry(draft.scores, { roundId: round.id, monitorId: target.id, mask, note }, weeklyScoreKey);
      return;
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
      if (id !== null && !read().players.some((player) => player.id === id)) throw localError("Elige un mánager inscrito.");
      activeId = id;
    },
    exportBackup() {
      return JSON.stringify(read(), null, 2);
    },
    exportMonitorRegister() {
      return JSON.stringify({
        format: MONITOR_REGISTER_FORMAT, version: 1, monitors: monitorRegisterRows(read()),
      }, null, 2);
    },
    async importMonitorRegister(serialized) {
      const entries = readMonitorRegister(serialized);
      return serializedWrite(() => {
        const draft = JSON.parse(JSON.stringify(read()));
        if (actorFor(draft)) throw localError("Selecciona la vista Organización para importar el registro.", 403);
        const sections = new Map(draft.sections.map(({ name, id }) => [localKey(name), id]));
        let added = 0;
        for (const { name, section, marketValueCents } of entries) {
          const sectionKey = localKey(section);
          let sectionId = sections.get(sectionKey);
          if (!sectionId) {
            sectionId = addLocalId(draft.sections);
            draft.sections.push({ id: sectionId, name: section, reviewerId: null });
            sections.set(sectionKey, sectionId);
          }
          if (addMonitorTo(draft, name, sectionId, marketValueCents)) added++;
        }
        if (added) write(draft);
        return added;
      });
    },
    async importBackup(serialized) {
      const next = normalizeCopy(serialized);
      await serializedWrite(() => write(next));
      activeId = null;
    },
  };
}
