import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { parseArgs, promisify } from "node:util";
import { contributionMask } from "./league.mjs";
import { LeagueStore, RequestError } from "./store.mjs";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest();
const hashToken = (token) => digest(token).toString("hex");
const sessionName = "fantasy_session";
const sessionAge = 7 * 24 * 60 * 60;
const maxBodyBytes = 8192;
const attemptWindow = 15 * 60 * 1000;
const assets = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
]);

function configuredSecret(value, name, minimum) {
  if (typeof value !== "string" || value.length < minimum || value.length > 128) {
    throw new Error(`Configura ${name} con entre ${minimum} y 128 caracteres.`);
  }
  return value;
}

function field(value, name, max, optional = false) {
  if (typeof value !== "string") throw new RequestError(400, `Revisa ${name}.`);
  const text = value.trim().normalize("NFC");
  if ((!optional && !text) || text.length > max || text.includes("\0")) {
    throw new RequestError(400, `Revisa ${name}. El máximo es de ${max} caracteres.`);
  }
  return text;
}

function positiveId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RequestError(400, "Elige una opción válida.");
  return value;
}

function dateField(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestError(400, "Introduce una fecha válida.");
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RequestError(400, "Introduce una fecha válida.");
  }
  return value;
}

function equalSecret(actual, expected) {
  return typeof actual === "string" && timingSafeEqual(digest(actual), digest(expected));
}

function passwordField(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new RequestError(400, "La contraseña debe tener entre 8 y 128 caracteres.");
  }
  return value;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

async function checkPassword(password, saved) {
  const [salt, hex] = saved?.split(":") ?? ["0".repeat(32), "0".repeat(128)];
  const hash = await derive(password, salt, 64);
  return timingSafeEqual(hash, Buffer.from(hex, "hex")) && Boolean(saved);
}

function readSessionHash(req) {
  const pair = (req.headers.cookie ?? "").split(";").map((value) => value.trim())
    .find((value) => value.startsWith(`${sessionName}=`));
  const token = pair?.slice(sessionName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? hashToken(token) : null;
}

function replyJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function requireOrigin(req, appOrigin) {
  const { origin, host } = req.headers;
  if (req.headers["sec-fetch-site"] === "cross-site" ||
      (origin && ![appOrigin, `http://${host}`, `https://${host}`].includes(origin))) {
    throw new RequestError(403, "Abre la aplicación desde su dirección para guardar cambios.");
  }
}

async function readJson(req) {
  const type = req.headers["content-type"]?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new RequestError(415, "Envía los datos del formulario.");
  if (Number(req.headers["content-length"]) > maxBodyBytes) {
    throw new RequestError(413, "El formulario es demasiado largo.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      req.resume();
      throw new RequestError(413, "El formulario es demasiado largo.");
    }
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Revisa los datos del formulario.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new RequestError(400, "Revisa los datos del formulario.");
  }
  return data;
}

function requireActor(actor, role) {
  if (!actor) throw new RequestError(401, "Inicia sesión para continuar.");
  if ((role === "admin" && !actor.isAdmin) || (role === "player" && actor.isAdmin)) {
    throw new RequestError(403, "Tu cuenta no tiene acceso a esta acción.");
  }
}

export function createApp({ databasePath, adminPassword, inviteCode, secureCookies = false, appOrigin }) {
  const adminSecret = configuredSecret(adminPassword, "ADMIN_PASSWORD", 12);
  const inviteSecret = configuredSecret(inviteCode, "INVITE_CODE", 8);
  const store = new LeagueStore(databasePath);
  const attempts = new Map();

  function attempt(req, operation) {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.expiresAt <= now) attempts.delete(key);
    }
    const key = `${req.socket.remoteAddress}:${operation}`;
    const entry = attempts.get(key) ?? { count: 0, expiresAt: now + attemptWindow };
    const limit = operation === "register" ? 40 : 20;
    if (entry.count >= limit) throw new RequestError(429, "Demasiados intentos. Vuelve a probar en unos minutos.");
    entry.count++;
    attempts.set(key, entry);
    return key;
  }

  function cookie(res, token, age) {
    const secure = secureCookies ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${sessionName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`);
  }

  function signIn(res, previous, playerId) {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    store.saveSession(hashToken(token), playerId, now + sessionAge * 1000, now);
    store.removeSession(previous);
    cookie(res, token, sessionAge);
  }

  async function api(req, res, path) {
    const method = req.method;
    const sessionHash = readSessionHash(req);
    const actor = store.session(sessionHash, Date.now());
    if (method === "GET" && path === "/api/state") return replyJson(res, 200, store.stateFor(actor));
    if (!["POST", "PUT", "PATCH"].includes(method)) throw new RequestError(404, "Página no encontrada.");

    requireOrigin(req, appOrigin);
    const body = await readJson(req);

    if (method === "POST" && path === "/api/register") {
      const key = attempt(req, "register");
      if (!equalSecret(body.inviteCode, inviteSecret)) throw new RequestError(403, "El código de invitación no coincide.");
      const alias = field(body.alias, "el alias", 32);
      const team = field(body.team, "el nombre del equipo", 52);
      const sectionId = positiveId(body.sectionId);
      const passwordHash = await hashPassword(passwordField(body.password));
      const playerId = store.register({ alias, team, sectionId, passwordHash });
      signIn(res, sessionHash, playerId);
      attempts.delete(key);
      return replyJson(res, 201, { ok: true });
    }

    if (method === "POST" && path === "/api/login") {
      const isAdmin = body.role === "admin";
      const key = attempt(req, isAdmin ? "admin" : "login");
      let playerId = null;
      if (isAdmin) {
        if (!equalSecret(body.password, adminSecret)) throw new RequestError(401, "La clave de organización no coincide.");
      } else {
        const alias = field(body.alias, "el alias", 32);
        const credential = store.credential(alias);
        const correct = await checkPassword(passwordField(body.password), credential?.passwordHash);
        if (!correct) throw new RequestError(401, "Revisa el alias y la contraseña.");
        playerId = credential.id;
      }
      signIn(res, sessionHash, playerId);
      attempts.delete(key);
      return replyJson(res, 200, { ok: true });
    }

    if (method === "POST" && path === "/api/logout") {
      store.removeSession(sessionHash);
      cookie(res, "", 0);
      return replyJson(res, 200, { ok: true });
    }

    const lineup = /^\/api\/rounds\/(\d+)\/lineup$/.exec(path);
    if (method === "PUT" && lineup) {
      requireActor(actor, "player");
      store.saveLineup(positiveId(Number(lineup[1])), actor.playerId, positiveId(body.firstPickId), positiveId(body.secondPickId));
      return replyJson(res, 200, { ok: true });
    }

    const score = /^\/api\/rounds\/(\d+)\/scores\/(\d+)$/.exec(path);
    if (method === "PUT" && score) {
      requireActor(actor);
      const mask = contributionMask(body.categories);
      if (mask === null) throw new RequestError(400, "Revisa las aportaciones seleccionadas.");
      const note = field(body.note ?? "", "la nota de aportaciones", 280, true);
      store.saveScore(positiveId(Number(score[1])), positiveId(Number(score[2])), actor, mask, note);
      return replyJson(res, 200, { ok: true });
    }

    if (method === "POST" && path === "/api/admin/sections") {
      requireActor(actor, "admin");
      store.addSection(field(body.name, "el nombre de la sección", 60));
      return replyJson(res, 201, { ok: true });
    }

    const section = /^\/api\/admin\/sections\/(\d+)$/.exec(path);
    if (method === "PATCH" && section) {
      requireActor(actor, "admin");
      const changes = {};
      if ("name" in body) changes.name = field(body.name, "el nombre de la sección", 60);
      if ("reviewerId" in body) changes.reviewerId = body.reviewerId === null ? null : positiveId(body.reviewerId);
      store.editSection(positiveId(Number(section[1])), changes);
      return replyJson(res, 200, { ok: true });
    }

    const round = /^\/api\/admin\/rounds\/(\d+)$/.exec(path);
    if (method === "PATCH" && round) {
      requireActor(actor, "admin");
      const changes = {};
      if ("challenge" in body) changes.challenge = field(body.challenge, "el reto de la jornada", 280);
      if ("date" in body) changes.date = dateField(body.date);
      if ("action" in body) changes.action = field(body.action, "la acción", 15);
      store.editRound(positiveId(Number(round[1])), changes);
      return replyJson(res, 200, { ok: true });
    }

    throw new RequestError(404, "Página no encontrada.");
  }

  const server = createServer(async (req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path.startsWith("/api/")) return await api(req, res, path);
      const asset = assets.get(path);
      if (!asset || !["GET", "HEAD"].includes(req.method)) {
        return replyJson(res, 404, { error: "Página no encontrada." });
      }
      const data = await readFile(new URL(`../public/${asset.file}`, import.meta.url));
      res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-cache" });
      return res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (error instanceof RequestError) return replyJson(res, error.status, { error: error.message });
      if (!res.headersSent) replyJson(res, 500, { error: "No se pudo completar la acción. Inténtalo de nuevo." });
      else res.end();
      console.error(error);
    }
  });
  server.on("close", () => store.close());
  return server;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      host: { type: "string" },
      port: { type: "string" },
      strictPort: { type: "boolean" },
    },
  });
  const port = Number(values.port ?? process.env.PORT ?? 3000);
  const host = values.host ?? process.env.HOST ?? "0.0.0.0";
  const server = createApp({
    databasePath: process.env.DATABASE_PATH ?? "./data/fantasy.sqlite",
    adminPassword: process.env.ADMIN_PASSWORD,
    inviteCode: process.env.INVITE_CODE,
    secureCookies: process.env.COOKIE_SECURE === "1",
    appOrigin: process.env.APP_ORIGIN,
  });
  server.listen(port, host, () => console.log(`Fantasy Scout en http://${host}:${server.address().port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
}
