import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { calculateStandings, CONTRIBUTIONS, lineupProblem, nextRoundStatus, STARTER_CHALLENGES } from "./league.mjs";

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
  CREATE TABLE IF NOT EXISTS lineups (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    first_pick_id INTEGER NOT NULL REFERENCES players(id),
    second_pick_id INTEGER NOT NULL REFERENCES players(id),
    PRIMARY KEY (round_id, player_id),
    CHECK (first_pick_id <> second_pick_id AND first_pick_id <> player_id AND second_pick_id <> player_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS scores (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    mask INTEGER NOT NULL CHECK (mask BETWEEN 0 AND 15),
    note TEXT NOT NULL,
    PRIMARY KEY (round_id, player_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    is_admin INTEGER NOT NULL CHECK (is_admin IN (0, 1)),
    expires_at INTEGER NOT NULL,
    CHECK ((is_admin = 1 AND player_id IS NULL) OR (is_admin = 0 AND player_id IS NOT NULL))
  ) STRICT;
`;

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
    });
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

  round(id) {
    const round = this.db.prepare(`SELECT ${ROUND_FIELDS} FROM rounds WHERE id = ?`).get(id);
    if (!round) throw new RequestError(404, "La jornada no existe.");
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
        throw new RequestError(400, "Elige a un scouter inscrito en esta sección.");
      }
      const duplicate = this.db.prepare("SELECT id FROM sections WHERE name_key = ? AND id <> ?").get(keyOf(name), id);
      if (duplicate) throw new RequestError(409, "Esa sección ya está inscrita.");
      this.db.prepare("UPDATE sections SET name = ?, name_key = ?, reviewer_id = ? WHERE id = ?")
        .run(name, keyOf(name), reviewerId, id);
    });
  }

  editRound(id, changes) {
    this.transaction(() => {
      const round = this.round(id);
      const status = changes.action === undefined ? round.status : nextRoundStatus(round.status, changes.action);
      if (!status) throw new RequestError(409, "La jornada cambió de estado. Actualiza la página.");
      const date = changes.date === undefined ? round.date : changes.date;
      this.db.prepare("UPDATE rounds SET challenge = ?, date = ?, status = ? WHERE id = ?")
        .run(changes.challenge ?? round.challenge, date, status, id);
    });
  }

  saveLineup(roundId, playerId, firstPickId, secondPickId) {
    this.transaction(() => {
      if (this.round(roundId).status !== "open") {
        throw new RequestError(409, "Los fichajes de esta jornada están cerrados.");
      }
      const manager = this.player(playerId);
      if (!manager) throw new RequestError(401, "Vuelve a iniciar sesión.");
      const problem = lineupProblem(manager, this.player(firstPickId), this.player(secondPickId));
      if (problem) throw new RequestError(400, problem);
      this.db.prepare(`
        INSERT INTO lineups (round_id, player_id, first_pick_id, second_pick_id) VALUES (?, ?, ?, ?)
        ON CONFLICT (round_id, player_id) DO UPDATE
          SET first_pick_id = excluded.first_pick_id, second_pick_id = excluded.second_pick_id
      `).run(roundId, playerId, firstPickId, secondPickId);
    });
  }

  saveScore(roundId, playerId, actor, mask, note) {
    this.transaction(() => {
      const player = this.player(playerId);
      if (!player) throw new RequestError(404, "El scouter no existe.");
      if (!actor.isAdmin && this.section(player.sectionId)?.reviewerId !== actor.playerId) {
        throw new RequestError(403, "Solo puedes puntuar en la sección que tienes asignada.");
      }
      if (this.round(roundId).status !== "scoring") {
        throw new RequestError(409, "La jornada debe estar en fase de puntuación.");
      }
      this.db.prepare(`
        INSERT INTO scores (round_id, player_id, mask, note) VALUES (?, ?, ?, ?)
        ON CONFLICT (round_id, player_id) DO UPDATE SET mask = excluded.mask, note = excluded.note
      `).run(roundId, playerId, mask, note);
    });
  }

  stateFor(actor) {
    return this.transaction(() => {
      const sections = this.db.prepare(`SELECT ${SECTION_FIELDS} FROM sections ORDER BY id`).all();
      const publicSections = sections.map(({ id, name }) => ({ id, name }));
      if (!actor) return { viewer: null, sections: publicSections };

      const players = this.db.prepare(`SELECT ${PLAYER_FIELDS} FROM players ORDER BY id`).all();
      const rounds = this.db.prepare(`SELECT ${ROUND_FIELDS} FROM rounds ORDER BY id`).all();
      const scores = this.db.prepare("SELECT round_id AS roundId, player_id AS playerId, mask, note FROM scores").all();
      const lineups = this.db.prepare(`
        SELECT round_id AS roundId, player_id AS playerId, first_pick_id AS firstPickId, second_pick_id AS secondPickId
        FROM lineups
      `).all();
      const reviewIds = sections.filter((section) => actor.isAdmin || section.reviewerId === actor.playerId)
        .map(({ id }) => id);
      const reviewed = new Set(reviewIds);
      const playerSections = new Map(players.map(({ id, sectionId }) => [id, sectionId]));
      const viewer = actor.isAdmin
        ? { role: "admin", reviewIds }
        : { role: "player", player: players.find(({ id }) => id === actor.playerId), reviewIds };
      return {
        viewer,
        sections: actor.isAdmin ? sections : publicSections,
        players,
        rounds,
        contributions: CONTRIBUTIONS,
        standings: calculateStandings(players, rounds, scores, lineups),
        lineups: lineups.filter(({ playerId }) => playerId === actor.playerId),
        reviewScores: scores.filter(({ playerId }) => reviewed.has(playerSections.get(playerId))),
      };
    }, "BEGIN");
  }
}
