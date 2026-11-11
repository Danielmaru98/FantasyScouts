import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  convertLegacyGame, DEFAULT_ROSTER_SIZE, leagueView, MAX_ROSTER_SIZE,
  nextRoundStatus, rosterAfterTransfer, rosterProblem, STARTER_CHALLENGES, validRosterSize,
} from "./league.mjs";

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const keyOf = (value) => value.normalize("NFKC").toLocaleLowerCase("es");
const PLAYER_FIELDS = "id, alias, team, section_id AS sectionId";
const ROUND_FIELDS = "id, challenge, date, status";
const SECTION_FIELDS = "id, name, reviewer_id AS reviewerId";
const MONITOR_FIELDS = "id, name, section_id AS sectionId";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    reviewer_id INTEGER REFERENCES players(id) ON DELETE SET NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    alias TEXT NOT NULL,
    alias_key TEXT NOT NULL UNIQUE,
    team TEXT NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    password_hash TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY,
    challenge TEXT NOT NULL,
    date TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'open', 'scoring', 'closed'))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    UNIQUE (section_id, name_key)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS roster_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    roster_size INTEGER NOT NULL CHECK (roster_size BETWEEN 1 AND ${MAX_ROSTER_SIZE})
  ) STRICT;
  CREATE TABLE IF NOT EXISTS team_roster_members (
    player_id INTEGER NOT NULL REFERENCES players(id),
    monitor_id INTEGER NOT NULL REFERENCES monitors(id),
    PRIMARY KEY (player_id, monitor_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS round_roster_members (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    monitor_id INTEGER NOT NULL REFERENCES monitors(id),
    PRIMARY KEY (round_id, player_id, monitor_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS monitor_scores (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    monitor_id INTEGER NOT NULL REFERENCES monitors(id),
    mask INTEGER NOT NULL CHECK (mask BETWEEN 0 AND 15),
    note TEXT NOT NULL,
    PRIMARY KEY (round_id, monitor_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    is_admin INTEGER NOT NULL CHECK (is_admin IN (0, 1)),
    expires_at INTEGER NOT NULL,
    CHECK ((is_admin = 1 AND player_id IS NULL) OR (is_admin = 0 AND player_id IS NOT NULL))
  ) STRICT;
`;

function groupRosterMembers(rows) {
  const grouped = new Map();
  for (const { roundId, playerId, monitorId } of rows) {
    const key = roundId === undefined ? playerId : `${roundId}/${playerId}`;
    if (!grouped.has(key)) grouped.set(key, { roundId, playerId, monitorIds: [] });
    grouped.get(key).monitorIds.push(monitorId);
  }
  return [...grouped.values()];
}

export class LeagueStore {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    this.transaction(() => {
      const name = "Tropa Jungla";
      this.db.prepare("INSERT OR IGNORE INTO sections (id, name, name_key) VALUES (1, ?, ?)")
        .run(name, keyOf(name));
      const insert = this.db.prepare("INSERT OR IGNORE INTO rounds (id, challenge) VALUES (?, ?)");
      STARTER_CHALLENGES.forEach((challenge, index) => insert.run(index + 1, challenge));
      this.db.prepare("INSERT OR IGNORE INTO roster_settings (id, roster_size) VALUES (1, ?)")
        .run(DEFAULT_ROSTER_SIZE);
      this.upgradeLegacyGame();
    });
  }

  upgradeLegacyGame() {
    if (this.db.prepare("PRAGMA user_version").get().user_version >= 2) return;
    const legacyTables = this.db.prepare(
      "SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'table' AND name IN ('lineups', 'scores')",
    ).get();
    if (legacyTables.total === 2) {
      const legacy = convertLegacyGame({
        players: this.db.prepare(`SELECT ${PLAYER_FIELDS} FROM players ORDER BY id`).all(),
        rounds: this.db.prepare(`SELECT ${ROUND_FIELDS} FROM rounds`).all(),
        lineups: this.db.prepare(`
          SELECT round_id AS roundId, player_id AS playerId, first_pick_id AS firstPickId, second_pick_id AS secondPickId
          FROM lineups
        `).all(),
        scores: this.db.prepare("SELECT round_id AS roundId, player_id AS playerId, mask, note FROM scores").all(),
      });
      const monitor = this.db.prepare("INSERT INTO monitors (id, name, name_key, section_id) VALUES (?, ?, ?, ?)");
      for (const { id, name, sectionId } of legacy.monitors) monitor.run(id, name, keyOf(name), sectionId);
      const roster = this.db.prepare("INSERT INTO team_roster_members (player_id, monitor_id) VALUES (?, ?)");
      for (const { playerId, monitorIds } of legacy.rosters) {
        for (const monitorId of monitorIds) roster.run(playerId, monitorId);
      }
      const weekly = this.db.prepare("INSERT INTO round_roster_members (round_id, player_id, monitor_id) VALUES (?, ?, ?)");
      for (const { roundId, playerId, monitorIds } of legacy.roundRosters) {
        for (const monitorId of monitorIds) weekly.run(roundId, playerId, monitorId);
      }
      const score = this.db.prepare("INSERT INTO monitor_scores (round_id, monitor_id, mask, note) VALUES (?, ?, ?, ?)");
      for (const { roundId, monitorId, mask, note } of legacy.scores) score.run(roundId, monitorId, mask, note);
    }
    this.db.exec("PRAGMA user_version = 2");
  }

  close() {
    this.db.close();
  }

  transaction(work, begin = "BEGIN IMMEDIATE") {
    this.db.exec(begin);
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  section(id) {
    return this.db.prepare(`SELECT ${SECTION_FIELDS} FROM sections WHERE id = ?`).get(id);
  }

  player(id) {
    return this.db.prepare(`SELECT ${PLAYER_FIELDS} FROM players WHERE id = ?`).get(id);
  }

  monitor(id) {
    return this.db.prepare(`SELECT ${MONITOR_FIELDS} FROM monitors WHERE id = ?`).get(id);
  }

  rosterSize() {
    return this.db.prepare("SELECT roster_size AS size FROM roster_settings WHERE id = 1").get().size;
  }

  round(id) {
    const round = this.db.prepare(`SELECT ${ROUND_FIELDS} FROM rounds WHERE id = ?`).get(id);
    if (!round) throw new RequestError(404, "La semana no existe.");
    return round;
  }

  credential(alias) {
    return this.db.prepare("SELECT id, password_hash AS passwordHash FROM players WHERE alias_key = ?").get(keyOf(alias));
  }

  register({ alias, team, sectionId, passwordHash }) {
    return this.transaction(() => {
      if (!this.section(sectionId)) throw new RequestError(400, "Elige una sección de la liga.");
      if (this.credential(alias)) throw new RequestError(409, "Ese alias ya está inscrito. Prueba con otro.");
      const result = this.db.prepare(
        "INSERT INTO players (alias, alias_key, team, section_id, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(alias, keyOf(alias), team, sectionId, passwordHash);
      return Number(result.lastInsertRowid);
    });
  }

  saveSession(tokenHash, playerId, expiresAt, now) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
      this.db.prepare("INSERT INTO sessions (token_hash, player_id, is_admin, expires_at) VALUES (?, ?, ?, ?)")
        .run(tokenHash, playerId, Number(playerId === null), expiresAt);
    });
  }

  session(tokenHash, now) {
    if (!tokenHash) return null;
    return this.db.prepare(
      "SELECT player_id AS playerId, is_admin AS isAdmin FROM sessions WHERE token_hash = ? AND expires_at > ?",
    ).get(tokenHash, now) ?? null;
  }

  removeSession(tokenHash) {
    if (tokenHash) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  addSection(name) {
    return this.transaction(() => {
      if (this.db.prepare("SELECT id FROM sections WHERE name_key = ?").get(keyOf(name))) {
        throw new RequestError(409, "Esa sección ya está inscrita.");
      }
      this.db.prepare("INSERT INTO sections (name, name_key) VALUES (?, ?)").run(name, keyOf(name));
    });
  }

  editSection(id, changes) {
    this.transaction(() => {
      const section = this.section(id);
      if (!section) throw new RequestError(404, "La sección no existe.");
      const name = changes.name ?? section.name;
      const reviewerId = changes.reviewerId === undefined ? section.reviewerId : changes.reviewerId;
      if (reviewerId !== null && this.player(reviewerId)?.sectionId !== id) {
        throw new RequestError(400, "Elige a un mánager de esta sección.");
      }
      const duplicate = this.db.prepare("SELECT id FROM sections WHERE name_key = ? AND id <> ?").get(keyOf(name), id);
      if (duplicate) throw new RequestError(409, "Esa sección ya está inscrita.");
      this.db.prepare("UPDATE sections SET name = ?, name_key = ?, reviewer_id = ? WHERE id = ?")
        .run(name, keyOf(name), reviewerId, id);
    });
  }

  addMonitor(name, sectionId) {
    this.transaction(() => {
      if (!this.section(sectionId)) throw new RequestError(400, "Elige una sección de la liga.");
      if (this.db.prepare("SELECT id FROM monitors WHERE section_id = ? AND name_key = ?").get(sectionId, keyOf(name))) {
        throw new RequestError(409, "Ese monitor ya está registrado en esta sección.");
      }
      this.db.prepare("INSERT INTO monitors (name, name_key, section_id) VALUES (?, ?, ?)").run(name, keyOf(name), sectionId);
    });
  }

  setRosterSize(size) {
    this.transaction(() => {
      if (!validRosterSize(size)) {
        throw new RequestError(400, `Elige un límite entre 1 y ${MAX_ROSTER_SIZE} monitores.`);
      }
      const tooLarge = this.db.prepare("SELECT player_id FROM team_roster_members GROUP BY player_id HAVING COUNT(*) > ? LIMIT 1")
        .get(size);
      if (tooLarge) throw new RequestError(409, "Reduce las plantillas que superen el nuevo límite antes de guardarlo.");
      this.db.prepare("UPDATE roster_settings SET roster_size = ? WHERE id = 1").run(size);
    });
  }

  addRound(challenge, date) {
    this.db.prepare("INSERT INTO rounds (challenge, date) VALUES (?, ?)").run(challenge, date);
  }

  editRound(id, changes) {
    this.transaction(() => {
      const round = this.round(id);
      const status = changes.action === undefined ? round.status : nextRoundStatus(round.status, changes.action);
      if (!status) throw new RequestError(409, "La semana cambió de estado. Actualiza la página.");
      const date = changes.date === undefined ? round.date : changes.date;
      if (round.status === "open" && status === "scoring") {
        this.db.prepare(`
          INSERT INTO round_roster_members (round_id, player_id, monitor_id)
          SELECT ?, player_id, monitor_id FROM team_roster_members
        `).run(id);
      }
      this.db.prepare("UPDATE rounds SET challenge = ?, date = ?, status = ? WHERE id = ?")
        .run(changes.challenge ?? round.challenge, date, status, id);
    });
  }

  saveRoster(playerId, monitorIds) {
    this.transaction(() => {
      if (!this.player(playerId)) throw new RequestError(401, "Vuelve a iniciar sesión.");
      const monitors = this.db.prepare("SELECT id FROM monitors").all();
      const problem = rosterProblem(monitorIds, monitors, this.rosterSize());
      if (problem) throw new RequestError(400, problem);
      this.db.prepare("DELETE FROM team_roster_members WHERE player_id = ?").run(playerId);
      const add = this.db.prepare("INSERT INTO team_roster_members (player_id, monitor_id) VALUES (?, ?)");
      for (const monitorId of monitorIds) add.run(playerId, monitorId);
    });
  }

  transferMonitor(playerId, monitorId, action) {
    this.transaction(() => {
      if (!this.player(playerId)) throw new RequestError(401, "Vuelve a iniciar sesión.");
      const currentIds = this.db.prepare("SELECT monitor_id AS id FROM team_roster_members WHERE player_id = ?")
        .all(playerId).map(({ id }) => id);
      const monitors = this.db.prepare("SELECT id FROM monitors").all();
      const { problem } = rosterAfterTransfer(currentIds, monitors, this.rosterSize(), monitorId, action);
      if (problem) throw new RequestError(400, problem);
      if (action === "sign") {
        this.db.prepare(`
          INSERT INTO team_roster_members (player_id, monitor_id) VALUES (?, ?)
          ON CONFLICT (player_id, monitor_id) DO NOTHING
        `).run(playerId, monitorId);
      } else {
        this.db.prepare("DELETE FROM team_roster_members WHERE player_id = ? AND monitor_id = ?").run(playerId, monitorId);
      }
    });
  }

  saveScore(roundId, monitorId, actor, mask, note) {
    this.transaction(() => {
      const monitor = this.monitor(monitorId);
      if (!monitor) throw new RequestError(404, "El monitor no existe.");
      if (!actor.isAdmin && this.section(monitor.sectionId)?.reviewerId !== actor.playerId) {
        throw new RequestError(403, "Solo puedes puntuar en la sección que tienes asignada.");
      }
      if (this.round(roundId).status !== "scoring") {
        throw new RequestError(409, "La semana debe estar en fase de puntuación.");
      }
      this.db.prepare(`
        INSERT INTO monitor_scores (round_id, monitor_id, mask, note) VALUES (?, ?, ?, ?)
        ON CONFLICT (round_id, monitor_id) DO UPDATE SET mask = excluded.mask, note = excluded.note
      `).run(roundId, monitorId, mask, note);
    });
  }

  stateFor(actor) {
    return this.transaction(() => {
      const sections = this.db.prepare(`SELECT ${SECTION_FIELDS} FROM sections ORDER BY id`).all();
      if (!actor) return leagueView({ sections }, null);
      const players = this.db.prepare(`SELECT ${PLAYER_FIELDS} FROM players ORDER BY id`).all();
      const monitors = this.db.prepare(`SELECT ${MONITOR_FIELDS} FROM monitors ORDER BY id`).all();
      const rounds = this.db.prepare(`SELECT ${ROUND_FIELDS} FROM rounds ORDER BY id`).all();
      const scores = this.db.prepare("SELECT round_id AS roundId, monitor_id AS monitorId, mask, note FROM monitor_scores").all();
      const rosters = groupRosterMembers(this.db.prepare(
        "SELECT player_id AS playerId, monitor_id AS monitorId FROM team_roster_members ORDER BY player_id, monitor_id",
      ).all());
      const roundRosters = groupRosterMembers(this.db.prepare(`
        SELECT round_id AS roundId, player_id AS playerId, monitor_id AS monitorId
        FROM round_roster_members ORDER BY round_id, player_id, monitor_id
      `).all());
      return leagueView({ sections, players, monitors, rounds, rosterSize: this.rosterSize(), rosters, roundRosters, scores }, actor);
    }, "BEGIN");
  }
}
