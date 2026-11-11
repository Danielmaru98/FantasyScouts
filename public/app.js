const app = document.querySelector("#app");
const notice = document.querySelector("#notice");
const localLeague = window.fantasyScoutLocal ?? null;
const dates = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Madrid" });
const labels = { planned: "Programada", open: "Plantillas abiertas", scoring: "En puntuación", closed: "Cerrada" };
const routes = { inicio: "Inicio", alineacion: "Mi equipo", clasificacion: "Clasificación", jornadas: "Semanas", gestion: "Gestión" };
const transition = {
  planned: { action: "open", label: "Abrir semana", hint: "Los mánagers podrán revisar su equipo para esta semana." },
  open: { action: "lock", label: "Fijar plantillas", hint: "Guarda la plantilla de cada equipo para esta semana y habilita el registro de puntos." },
  scoring: { action: "close", label: "Cerrar semana", hint: "Comprueba las aportaciones antes de cerrar." },
  closed: { action: "reopen", label: "Reabrir puntuación", hint: "Podrás corregir los puntos de los monitores de esta semana." },
};
const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const h = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
const choose = (value, current) => value === current ? " selected" : "";
const errorRegion = '<p class="form-error" data-error role="alert" hidden></p>';
const refreshButton = '<button class="button secondary" type="button" data-command="refresh">Actualizar</button>';

let state;
let authMode = "login";
let manageTab = "rounds";
let lineupRound;
let setupRound;
let reviewRound;
let reviewSection = 0;
let reviewMonitor;
let saving = false;
let noticeTimer;
let currentRoute = "inicio";

const isAdmin = () => state.viewer?.role === "admin";
const canReview = () => isAdmin() || Boolean(state.viewer?.reviewIds.length);
const me = () => state.viewer?.player;
const sectionName = (id) => state.sections.find((section) => section.id === id)?.name ?? "Sección";
const monitorFor = (id) => state.monitors.find((monitor) => monitor.id === id);
const myStanding = () => state.standings.find((entry) => entry.id === me()?.id);
const isWeekLocked = (round) => round.status === "scoring" || round.status === "closed";
const myWeeklyRoster = (round) => isWeekLocked(round)
  ? state.weeklyRosters.find(({ roundId }) => roundId === round.id)?.monitorIds ?? []
  : state.roster;
const hasResults = (row) => row?.results.some(({ scored }) => scored);
const activeRound = () => state.rounds.find(({ status }) => status === "open") ??
  state.rounds.find(({ status }) => status === "scoring") ??
  state.rounds.find(({ status }) => status === "planned") ?? state.rounds.at(-1);
const roundFor = (id) => state.rounds.find((round) => round.id === id) ?? activeRound();

function alertUser(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4200);
}

async function request(path, method = "GET", body) {
  if (localLeague) return localLeague.request(path, method, body);
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.error ?? "No se pudo contactar con la liga. Inténtalo de nuevo.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function reload() {
  state = await request("/api/state");
}

function sectionOptions() {
  return '<option value="">Elige una sección</option>' + state.sections.map(({ id, name }) =>
    `<option value="${id}">${h(name)}</option>`).join("");
}

function brand(link = true) {
  const tag = link ? "a" : "div";
  const href = link ? ' href="#inicio" data-route' : "";
  return `<${tag} class="brand"${href}>
    <span class="mark" aria-hidden="true"></span>
    <span><span class="brand-name">FantasyScout</span><span class="brand-group">Grupo 108 · Lorca</span></span>
  </${tag}>`;
}

function authScreen() {
  const joining = authMode === "register";
  const organizing = authMode === "admin";
  const title = joining ? "Inscribirme en la liga" : organizing ? "Acceso de organización" : "Entra en tu equipo";
  const intro = joining ? "Usa el código que comparta la organización del grupo."
    : organizing ? "Gestiona monitores, semanas y puntuaciones." : "Accede con el alias que elegiste al inscribirte.";
  const formName = joining ? "register" : organizing ? "admin-login" : "login";
  return `<main class="auth-shell" id="main" tabindex="-1">
    <section class="auth-story">
      ${brand(false)}
      <div class="story-copy">
        <p class="eyebrow">Grupo Scout Ciudad del Sol 108</p>
        <h1>FantasyScout</h1>
        <p>Forma tu equipo de monitores del grupo y suma puntos por lo que hagan cada semana.</p>
      </div>
    </section>
    <section class="auth-panel">
      <div class="auth-box">
        <h2>${title}</h2><p class="muted">${intro}</p>
        ${organizing ? "" : `<div class="auth-switch" aria-label="Acceso a la liga">
          <button type="button" data-auth="login" aria-pressed="${!joining}">Entrar</button>
          <button type="button" data-auth="register" aria-pressed="${joining}">Inscribirme</button>
        </div>`}
        <form class="form" data-form="${formName}">
          ${organizing ? "" : `<div class="field"><label for="alias">Alias</label><input id="alias" name="alias" autocomplete="username" maxlength="32" required></div>`}
          ${joining ? `<div class="field"><label for="team">Nombre de tu equipo</label><input id="team" name="team" maxlength="52" required></div>
          <div class="field"><label for="join-section">Sección del mánager</label><select id="join-section" name="sectionId" required>${sectionOptions()}</select></div>` : ""}
          <div class="field"><label for="password">${organizing ? "Clave de organización" : "Contraseña"}</label>
            <input id="password" name="password" type="password" autocomplete="${joining ? "new-password" : "current-password"}" minlength="${organizing ? 12 : 8}" maxlength="128" required>
          </div>
          ${joining ? '<div class="field"><label for="invite">Código de invitación</label><input id="invite" name="inviteCode" autocomplete="off" maxlength="128" required></div>' : ""}
          ${errorRegion}
          <button class="button primary" type="submit">${joining ? "Crear mi equipo" : "Entrar"}</button>
        </form>
        <p class="auth-link"><button type="button" class="link-button" data-auth="${organizing ? "login" : "admin"}">
          ${organizing ? "Volver al acceso de mánagers" : "Acceso de organización"}</button></p>
      </div>
    </section>
  </main>`;
}

function roundStatus(round) {
  return `<span class="pill ${round.status}">${labels[round.status]}</span>`;
}

function roundDate(round) {
  return round.date ? `<time class="round-date" datetime="${h(round.date)}">${dates.format(new Date(`${round.date}T12:00:00Z`))}</time>` : "";
}

function topBar() {
  const tabs = Object.entries(routes).filter(([key]) => {
    return (key !== "alineacion" || !isAdmin()) && (key !== "gestion" || canReview());
  });
  const account = localLeague ? `<div class="local-account">
    <label for="local-view">Vista local</label>
    <select id="local-view" data-select="local-view">
      <option value="">Organización</option>
      ${state.players.map(({ id, alias }) => `<option value="${id}"${choose(id, me()?.id)}>${h(alias)}</option>`).join("")}
    </select>
  </div>` : `<div class="account"><span>${isAdmin() ? "Organización" : h(me().alias)}</span>
    <button type="button" class="button secondary" data-command="logout">Salir</button>
  </div>`;
  return `<header class="topbar"><div class="topbar-inner">
    ${brand()}
    <nav class="main-nav" aria-label="Navegación principal">
      ${tabs.map(([key, label]) => `<a href="#${key}" data-route${key === currentRoute ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
    ${account}
  </div></header>`;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0]).join("");
}

function personLine(title, detail) {
  return `<div class="person-line"><span class="avatar" aria-hidden="true">${h(initials(title))}</span>
    <span class="person-copy"><strong>${h(title)}</strong><small>${h(detail)}</small></span></div>`;
}

function rosterSummary(round) {
  const members = myWeeklyRoster(round).map(monitorFor).filter(Boolean);
  if (!members.length) return '<p class="empty">La plantilla de esta semana está vacía.</p>';
  const scores = new Map(state.monitorPoints.filter(({ roundId }) => roundId === round.id)
    .map(({ monitorId, points }) => [monitorId, points]));
  return `<ul class="person-list">${members.map((monitor) => {
    const points = scores.get(monitor.id);
    return `<li>${personLine(monitor.name, sectionName(monitor.sectionId))}
      <span class="points">${points === undefined && round.status !== "closed" ? "—" : `${points ?? 0} pt`}</span></li>`;
  }).join("")}</ul>`;
}

function stat(label, value) {
  return `<div class="card stat"><strong>${h(value)}</strong><span>${label}</span></div>`;
}

function topFive() {
  if (!state.standings.length) return '<p class="empty">Los equipos aparecerán cuando se inscriban sus mánagers.</p>';
  return `<ol class="leader-list">${state.standings.slice(0, 5).map((row) => `<li>
    <span class="rank">${hasResults(row) ? row.rank : "—"}</span>
    ${personLine(row.team, row.alias)}
    <span class="points">${row.total} pt</span>
  </li>`).join("")}</ol>`;
}

function home() {
  const round = activeRound();
  const standing = myStanding();
  const weekly = standing?.results.find(({ roundId }) => roundId === round.id);
  const needsMonitors = isAdmin() && state.monitors.length === 0;
  const needsTeams = isAdmin() && localLeague && state.players.length === 0;
  const preparing = needsMonitors || needsTeams;
  const title = preparing ? "Prepara tu liga" : `Semana ${round.id}`;
  const description = needsMonitors ? "Registra a los monitores de cada sección para que los mánagers puedan ficharlos."
    : needsTeams ? "Inscríbete como mánager y añade los equipos de las demás personas."
      : round.challenge || "Consulta las plantillas y los puntos de esta semana.";
  const action = needsMonitors ? '<a class="button accent" href="#gestion" data-route data-panel="monitors">Registrar monitores</a>'
    : needsTeams ? '<a class="button accent" href="#gestion" data-route data-panel="players">Inscribir equipos</a>'
      : isAdmin() ? '<a class="button accent" href="#gestion" data-route data-panel="rounds">Gestionar semana</a>'
        : `<a class="button accent" href="#alineacion" data-route data-round="${round.id}">Ver mi equipo</a>`;
  return `<section class="hero"><div class="hero-content">
    <div class="hero-meta">${preparing ? '<span class="eyebrow">FantasyScout 108</span>' : roundStatus(round)}</div>
    <h1>${title}</h1><p>${h(description)}</p>${action}
  </div></section>
  <section class="stat-grid" aria-label="Datos de la liga">
    ${isAdmin() ? stat("Equipos inscritos", state.players.length) + stat("Monitores registrados", state.monitors.length) +
      stat("Semanas cerradas", `${state.rounds.filter(({ status }) => status === "closed").length}/${state.rounds.length}`) :
      stat("Tu puesto", hasResults(standing) ? standing.rank : "—") + stat("Puntos totales", standing?.total ?? 0) +
      stat(`Puntos semana ${round.id}`, weekly?.scored ? weekly.total : "—")}
  </section>
  <div class="home-grid">
    <section class="card"><div class="card-head"><h2>Clasificación</h2><a href="#clasificacion" data-route class="link-button">Ver tabla</a></div>${topFive()}</section>
    <section class="card"><div class="card-head"><h2>${isAdmin() ? "Monitores por sección" : "Tu plantilla"}</h2>
      ${isAdmin() ? "" : `<span class="hint">Semana ${round.id}</span>`}</div>
      ${isAdmin() ? `<ul class="rule-list">${state.sections.map(({ id, name }) => `<li><strong>${h(name)}</strong><span class="pill">${state.monitors.filter(({ sectionId }) => sectionId === id).length}</span></li>`).join("")}</ul>` : rosterSummary(round)}
    </section>
  </div>`;
}

function pageHead(title, description, action = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p class="muted">${description}</p></div>${action}</div>`;
}

function roundSelect(id, value) {
  return `<div class="field"><label for="${id}">Semana</label>
    <select id="${id}" data-select="${id}">${state.rounds.map((round) =>
      `<option value="${round.id}"${choose(round.id, value)}>Semana ${round.id} · ${labels[round.status]}</option>`).join("")}</select>
  </div>`;
}

function monitorPicker() {
  const selected = new Set(state.roster);
  const groups = state.sections.map((section) => {
    const monitors = state.monitors.filter(({ sectionId }) => sectionId === section.id);
    if (!monitors.length) return "";
    return `<fieldset><legend>${h(section.name)}</legend><ul class="checklist">${monitors.map(({ id, name }) =>
      `<li><label class="check-row"><input type="checkbox" name="monitor" value="${id}"${selected.has(id) ? " checked" : ""}><strong>${h(name)}</strong></label></li>`,
    ).join("")}</ul></fieldset>`;
  }).join("");
  return `<form class="form" data-form="roster">
    <div class="card-head"><h2>Plantilla</h2><output class="pill open" data-roster-count>${selected.size} de ${state.rosterSize}</output></div>
    <p class="hint">Puedes fichar monitores de cualquier sección. La plantilla se conserva entre semanas.</p>
    <div class="monitor-picker">${groups}</div>
    ${errorRegion}<button class="button primary" type="submit">Guardar plantilla</button>
  </form>`;
}

function lineupPage() {
  const round = roundFor(lineupRound);
  const result = myStanding()?.results.find(({ roundId }) => roundId === round.id);
  return `${pageHead("Mi equipo", h(me().team), refreshButton)}
    <div class="manage-grid">
      <section class="card">
        ${state.monitors.length ? monitorPicker() : '<h2>Plantilla</h2><p class="empty">La organización añadirá los monitores disponibles.</p>'}
      </section>
      <section class="card">
        <h2>Puntos de la plantilla</h2>
        ${roundSelect("lineup-round", round.id)}
        <div class="round-meta">${roundStatus(round)}${roundDate(round)}</div>
        ${rosterSummary(round)}
        ${result?.scored ? `<p><strong>Total de la semana ${result.total} pt</strong></p>` :
          '<p class="hint">La organización fija la plantilla al iniciar la semana.</p>'}
      </section>
    </div>`;
}

function standingsPage() {
  return `${pageHead("Clasificación", "Cada semana suma los puntos de los monitores de la plantilla. En empate, los equipos comparten puesto.", refreshButton)}
    <section class="card table-card">${state.standings.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla de clasificación">
      <table><thead><tr><th scope="col">Puesto</th><th scope="col">Equipo</th>
        ${state.rounds.map(({ id }) => `<th scope="col" class="num" aria-label="Semana ${id}">S${id}</th>`).join("")}
        <th scope="col" class="num">Total</th>
      </tr></thead><tbody>${state.standings.map((row) => `<tr${row.id === me()?.id ? ' class="active-row"' : ""}>
        <td class="rank">${hasResults(row) ? row.rank : "—"}</td>
        <th scope="row">${personLine(row.team, row.alias)}</th>
        ${row.results.map((result) => `<td class="num">${result.scored ? result.total : "—"}</td>`).join("")}
        <td class="num points">${row.total}</td>
      </tr>`).join("")}</tbody></table>
    </div>` : '<p class="empty">Los equipos aparecerán cuando se inscriban sus mánagers.</p>'}</section>`;
}

function roundsPage() {
  return `${pageHead("Semanas", "Consulta el calendario y la fase de cada semana.")}
    <div class="round-grid">${state.rounds.map((round) => `<article class="card round-card">
      <div class="card-head"><h2>Semana ${round.id}</h2>${roundStatus(round)}</div>
      ${roundDate(round)}${round.challenge ? `<p>${h(round.challenge)}</p>` : ""}
      ${isAdmin() ? "" : `<a href="#alineacion" data-route data-round="${round.id}" class="button secondary">Ver mi equipo</a>`}
    </article>`).join("")}</div>
    <section class="card">
      <div class="card-head"><h2>Cómo se puntúa</h2></div>
      <div class="rules-grid"><ul class="rule-list">${state.contributions.map(({ label, description, points }) =>
        `<li><strong>${label}</strong><small>${description}</small><span class="pill open">+${points}</span></li>`).join("")}</ul>
      <div><p>Cada monitor puede sumar una vez por categoría y semana. Cada aportación cuenta en una sola categoría.</p>
        <p>Todos los equipos que tengan fichado a un monitor reciben los puntos que consiga esa semana.</p></div></div>
    </section>`;
}

function manageRounds() {
  const round = roundFor(setupRound);
  const next = transition[round.status];
  return `<div class="manage-grid">
    <section class="card">
      <h2>Calendario</h2>
      ${roundSelect("setup-round", round.id)}
      <form class="form" data-form="round" data-id="${round.id}">
        <div class="field"><label for="round-date">Fecha de la semana</label><input id="round-date" name="date" type="date" value="${h(round.date)}"></div>
        <div class="field"><label for="round-challenge">Reto común</label><textarea id="round-challenge" name="challenge" maxlength="280" placeholder="Opcional">${h(round.challenge)}</textarea></div>
        ${errorRegion}<button class="button secondary" type="submit">Guardar calendario</button>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h2>Fase de la semana</h2>${roundStatus(round)}</div>
      <p class="muted">${next.hint}</p>
      <form class="form" data-form="phase" data-id="${round.id}" data-action="${next.action}">
        ${errorRegion}<button class="button primary" type="submit">${next.label}</button>
      </form>
    </section>
  </div>
  <section class="card">
    <div class="card-head"><h2>Añadir semana</h2></div>
    <form class="form" data-form="add-round">
      <div class="form-columns">
        <div class="field"><label for="next-date">Fecha de la nueva semana</label><input id="next-date" name="date" type="date"></div>
        <div class="field"><label for="next-challenge">Reto de la nueva semana</label><input id="next-challenge" name="challenge" maxlength="280" placeholder="Opcional"></div>
      </div>
      ${errorRegion}<button class="button secondary" type="submit">Añadir semana</button>
    </form>
  </section>`;
}

function manageSections() {
  return `<section class="card">
    <div class="card-head"><h2>Añadir sección</h2></div>
    <form class="form" data-form="add-section">
      <div class="field"><label for="new-section">Nombre de la sección</label><input id="new-section" name="name" maxlength="60" required></div>
      ${errorRegion}<button class="button primary" type="submit">Añadir sección</button>
    </form>
  </section>
  <div class="section-grid">${state.sections.map((section) => {
    const members = state.players.filter(({ sectionId }) => sectionId === section.id);
    const count = state.monitors.filter(({ sectionId }) => sectionId === section.id).length;
    return `<section class="card">
      <div class="card-head"><h2>${h(section.name)}</h2><span class="pill">${count} monitores</span></div>
      <form class="form" data-form="edit-section" data-id="${section.id}">
        <div class="field"><label for="section-${section.id}">Nombre</label><input id="section-${section.id}" name="name" value="${h(section.name)}" maxlength="60" required></div>
        <div class="field"><label for="reviewer-${section.id}">Responsable de puntuación</label><select id="reviewer-${section.id}" name="reviewerId">
          <option value="">Organización</option>
          ${members.map(({ id, alias }) => `<option value="${id}"${choose(id, section.reviewerId)}>${h(alias)}</option>`).join("")}
        </select></div>
        ${errorRegion}<button class="button secondary" type="submit">Guardar sección</button>
      </form>
    </section>`;
  }).join("")}</div>`;
}

function manageMonitors() {
  return `<div class="manage-grid">
    <section class="card">
      <h2>Registrar monitor</h2>
      <form class="form" data-form="add-monitor">
        <div class="field"><label for="monitor-name">Nombre del monitor</label><input id="monitor-name" name="name" maxlength="60" required></div>
        <div class="field"><label for="monitor-section">Sección del monitor</label><select id="monitor-section" name="sectionId" required>${sectionOptions()}</select></div>
        ${errorRegion}<button class="button primary" type="submit">Registrar monitor</button>
      </form>
    </section>
    <section class="card">
      <h2>Monitores disponibles</h2>
      ${state.monitors.length ? `<ul class="person-list">${state.monitors.map(({ name, sectionId }) =>
        `<li>${personLine(name, sectionName(sectionId))}</li>`).join("")}</ul>` : '<p class="empty">Registra al primer monitor de la liga.</p>'}
    </section>
  </div>`;
}

function managePlayers() {
  const teams = `<section class="card">
    <div class="card-head"><h2>Equipos inscritos</h2></div>
    ${state.players.length ? `<ul class="person-list">${state.players.map(({ alias, team, sectionId }) =>
      `<li>${personLine(team, alias)}<span class="person-slot">${h(sectionName(sectionId))}</span></li>`).join("")}</ul>` :
      '<p class="empty">Los mánagers inscritos aparecerán aquí.</p>'}
  </section>`;
  return `<section class="card">
    <div class="card-head"><h2>Límite de plantilla</h2></div>
    <form class="form" data-form="settings">
      <div class="field"><label for="roster-size">Monitores por equipo</label>
        <input id="roster-size" name="rosterSize" type="number" min="1" max="${state.rosterLimit}" value="${state.rosterSize}" required>
      </div>
      ${errorRegion}<button class="button secondary" type="submit">Guardar límite</button>
    </form>
  </section>
  ${localLeague ? `<div class="manage-grid">
    <section class="card">
      <h2>Inscribir mánager</h2>
      <form class="form" data-form="add-player">
        <div class="field"><label for="local-alias">Alias del mánager</label><input id="local-alias" name="alias" maxlength="32" required></div>
        <div class="field"><label for="local-team">Nombre del equipo</label><input id="local-team" name="team" maxlength="52" required></div>
        <div class="field"><label for="local-section">Sección del mánager</label><select id="local-section" name="sectionId" required>${sectionOptions()}</select></div>
        ${errorRegion}<button class="button primary" type="submit">Crear equipo</button>
      </form>
    </section>${teams}</div>` : teams}`;
}

function manageBackup() {
  return `<div class="manage-grid">
    <section class="card">
      <h2>Guardar una copia</h2>
      <p class="muted">Descarga los monitores, los equipos, las plantillas y los puntos en un archivo JSON.</p>
      <button class="button primary" type="button" data-command="export-backup">Descargar copia</button>
    </section>
    <section class="card">
      <h2>Cargar una copia</h2>
      <p class="muted">La copia sustituirá la liga guardada en este navegador.</p>
      <form class="form" data-form="import-backup">
        <div class="field"><label for="local-backup">Copia de FantasyScout</label>
          <input id="local-backup" name="copy" type="file" accept=".json,application/json" required>
        </div>
        ${errorRegion}<button class="button secondary" type="submit">Importar y sustituir la liga</button>
      </form>
    </section>
  </div>`;
}

function manageScores() {
  const sections = state.sections.filter(({ id }) => state.viewer.reviewIds.includes(id));
  const round = roundFor(reviewRound ?? state.rounds.find(({ status }) => status === "scoring")?.id);
  const members = state.monitors.filter(({ sectionId }) =>
    state.viewer.reviewIds.includes(sectionId) && (!reviewSection || reviewSection === sectionId));
  const target = members.find(({ id }) => id === reviewMonitor) ?? members[0];
  const scores = new Map(state.reviewScores.filter(({ roundId }) => roundId === round.id).map((score) => [score.monitorId, score]));
  const saved = target ? scores.get(target.id) : null;
  const enabled = round.status === "scoring";
  const number = members.filter(({ id }) => scores.has(id)).length;
  const total = state.contributions.reduce((points, { points: value }, index) =>
    points + (saved?.mask & (1 << index) ? value : 0), 0);

  return `<div class="manage-grid">
    <section class="card">
      <div class="card-head"><h2>Semana y sección</h2>${roundStatus(round)}</div>
      ${roundSelect("review-round", round.id)}
      <div class="field"><label for="review-section">Sección</label><select id="review-section" data-select="review-section">
        <option value="0">Todas mis secciones</option>
        ${sections.map(({ id, name }) => `<option value="${id}"${choose(id, reviewSection)}>${h(name)}</option>`).join("")}
      </select></div>
      <div class="field"><label for="review-monitor">Monitor</label><select id="review-monitor" data-select="review-monitor"${target ? "" : " disabled"}>
        ${members.length ? members.map(({ id, name, sectionId }) => `<option value="${id}"${choose(id, target.id)}>${h(name)} · ${h(sectionName(sectionId))}${scores.has(id) ? " · registrado" : ""}</option>`).join("") : '<option>Sin monitores registrados</option>'}
      </select></div>
      <p class="hint">${number} de ${members.length} puntuaciones registradas.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Aportaciones ${target ? `de ${h(target.name)}` : ""}</h2>${target ? `<span class="pill open" data-points>${total} pt</span>` : ""}</div>
      ${target ? `<form class="form" data-form="score" data-id="${round.id}" data-monitor="${target.id}">
        ${enabled ? "" : '<p class="hint">La organización puede iniciar la puntuación desde Semanas.</p>'}
        <ul class="checklist">${state.contributions.map(({ id, label, description, points }, index) => `<li><label class="check-row">
          <input type="checkbox" name="category" value="${id}" data-value="${points}"${saved?.mask & (1 << index) ? " checked" : ""}${enabled ? "" : " disabled"}>
          <span><strong>${label}</strong><small>${description}</small></span><span class="points">+${points}</span>
        </label></li>`).join("")}</ul>
        <div class="field"><label for="score-note">Nota de aportaciones</label><textarea id="score-note" name="note" maxlength="280" placeholder="Opcional"${enabled ? "" : " disabled"}>${h(saved?.note)}</textarea></div>
        ${errorRegion}<button class="button primary" type="submit"${enabled ? "" : " disabled"}>Guardar puntuación</button>
      </form>` : '<p class="empty">Selecciona un monitor para registrar sus puntos.</p>'}
    </section>
  </div>`;
}

function managementPage() {
  const tabs = [["rounds", "Semanas"], ["scores", "Puntuaciones"], ["monitors", "Monitores"], ["players", "Equipos"], ["sections", "Secciones"]];
  if (localLeague) tabs.push(["backup", "Copia"]);
  const panel = isAdmin() ? manageTab : "scores";
  const panels = {
    rounds: manageRounds, scores: manageScores, sections: manageSections, monitors: manageMonitors,
    players: managePlayers, backup: manageBackup,
  };
  return `${pageHead("Gestión", isAdmin() ? "Organiza las semanas y registra el rendimiento de los monitores." : "Registra las aportaciones de tu sección.")}
    ${isAdmin() ? `<div class="segmented" aria-label="Panel de gestión">${tabs.map(([key, label]) =>
      `<button type="button" data-manage="${key}" aria-pressed="${panel === key}">${label}</button>`).join("")}</div>` : ""}
    ${panels[panel]()}`;
}

function render() {
  if (!state.viewer) {
    app.innerHTML = authScreen();
    return;
  }
  const requested = location.hash.slice(1);
  if (Object.hasOwn(routes, requested)) currentRoute = requested;
  if ((currentRoute === "gestion" && !canReview()) || (currentRoute === "alineacion" && isAdmin())) {
    currentRoute = "inicio";
  }
  const pages = { inicio: home, alineacion: lineupPage, clasificacion: standingsPage, jornadas: roundsPage, gestion: managementPage };
  const storageWarning = state.storageWarning ? `<p class="local-warning" role="status">${h(state.storageWarning)}</p>` : "";
  app.innerHTML = `${topBar()}<main class="workspace" id="main" tabindex="-1">${storageWarning}${pages[currentRoute]()}</main>
    <footer class="footer">Grupo Scout Ciudad del Sol 108</footer>`;
}

async function start() {
  try {
    await reload();
    render();
  } catch {
    app.innerHTML = '<main class="loading" id="main" tabindex="-1"><h1>FantasyScout</h1><p>No se pudo cargar la liga.</p><button class="button primary" data-command="refresh">Volver a intentar</button></main>';
  }
}

function resetRoute() {
  currentRoute = "inicio";
  authMode = "login";
  manageTab = "rounds";
  lineupRound = setupRound = reviewRound = reviewMonitor = undefined;
  reviewSection = 0;
  history.replaceState(null, "", "#inicio");
}

const actions = {
  login: ({ alias, password }) => ["/api/login", "POST", { alias, password }],
  "admin-login": ({ password }) => ["/api/login", "POST", { role: "admin", password }],
  register: (values) => ["/api/register", "POST", { ...values, sectionId: Number(values.sectionId) }, "Equipo inscrito."],
  roster: (_, form, data) => ["/api/roster", "PUT", { monitorIds: data.getAll("monitor").map(Number) }, "Plantilla guardada."],
  round: (values, form) => [`/api/admin/rounds/${form.dataset.id}`, "PATCH", values, "Calendario guardado."],
  "add-round": (values) => ["/api/admin/rounds", "POST", values, "Semana añadida."],
  phase: (_, form) => [`/api/admin/rounds/${form.dataset.id}`, "PATCH", { action: form.dataset.action }, "Fase actualizada."],
  "add-player": ({ alias, team, sectionId }) => ["/api/admin/players", "POST", { alias, team, sectionId: Number(sectionId) }, "Equipo inscrito."],
  "add-monitor": ({ name, sectionId }) => ["/api/admin/monitors", "POST", { name, sectionId: Number(sectionId) }, "Monitor registrado."],
  settings: ({ rosterSize }) => ["/api/admin/settings", "PATCH", { rosterSize: Number(rosterSize) }, "Límite actualizado."],
  "add-section": (values) => ["/api/admin/sections", "POST", values, "Sección añadida."],
  "edit-section": ({ name, reviewerId }, form) => [`/api/admin/sections/${form.dataset.id}`, "PATCH",
    { name, reviewerId: reviewerId ? Number(reviewerId) : null }, "Sección guardada."],
  score: ({ note }, form, data) => [`/api/rounds/${form.dataset.id}/scores/${form.dataset.monitor}`, "PUT",
    { categories: data.getAll("category"), note }, "Puntuación guardada."],
};

app.addEventListener("submit", async (event) => {
  const form = event.target;
  const action = actions[form.dataset.form];
  const importing = localLeague && form.dataset.form === "import-backup";
  if (!action && !importing) return;
  event.preventDefault();
  if (saving) return;
  const data = new FormData(form);
  const errorBox = form.querySelector("[data-error]");
  const button = form.querySelector('button[type="submit"]');
  saving = button.disabled = true;
  errorBox.hidden = true;
  try {
    let message;
    if (importing) {
      const copy = data.get("copy");
      if (!copy?.size || copy.size > 2 * 1024 * 1024) throw new Error("Elige una copia JSON de hasta 2 MB.");
      await localLeague.importBackup(await copy.text());
      message = "Copia cargada.";
    } else {
      const [path, method, body, feedback] = action(Object.fromEntries(data), form, data);
      await request(path, method, body);
      message = feedback;
    }
    await reload();
    if (["login", "admin-login", "register"].includes(form.dataset.form)) resetRoute();
    render();
    if (message) alertUser(message);
  } catch (error) {
    if (error.status === 401 && state.viewer) {
      await start();
      alertUser(error.message, true);
    } else {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  } finally {
    saving = button.disabled = false;
  }
});

app.addEventListener("change", async (event) => {
  const control = event.target;
  if (control.dataset.select === "local-view" && localLeague) {
    if (saving) {
      control.value = me()?.id ?? "";
      return;
    }
    saving = control.disabled = true;
    try {
      localLeague.viewAs(control.value ? Number(control.value) : null);
      await reload();
      resetRoute();
      render();
      document.getElementById("local-view")?.focus({ preventScroll: true });
    } catch (error) {
      alertUser(error.message, true);
    } finally {
      saving = control.disabled = false;
    }
    return;
  }
  if (control.name === "monitor") {
    const count = control.form.querySelectorAll('input[name="monitor"]:checked').length;
    control.form.querySelector("[data-roster-count]").textContent = `${count} de ${state.rosterSize}`;
    return;
  }
  if (control.name === "category") {
    const points = Array.from(control.form.querySelectorAll('input[name="category"]:checked'))
      .reduce((sum, checked) => sum + Number(checked.dataset.value), 0);
    control.closest("section").querySelector("[data-points]").textContent = `${points} pt`;
    return;
  }
  const value = Number(control.value);
  switch (control.dataset.select) {
    case "lineup-round": lineupRound = value; break;
    case "setup-round": setupRound = value; break;
    case "review-round": reviewRound = value; break;
    case "review-section": reviewSection = value; reviewMonitor = undefined; break;
    case "review-monitor": reviewMonitor = value; break;
    default: return;
  }
  render();
  document.getElementById(control.id)?.focus({ preventScroll: true });
});

app.addEventListener("click", async (event) => {
  const control = event.target.closest("button, a");
  if (!control) return;
  if (control.hasAttribute("data-route")) {
    if (control.dataset.round) lineupRound = Number(control.dataset.round);
    if (control.dataset.panel) manageTab = control.dataset.panel;
    if (control.getAttribute("href") === location.hash) render();
  } else if (control.dataset.auth) {
    authMode = control.dataset.auth;
    render();
    app.querySelector("input")?.focus();
  } else if (control.dataset.manage) {
    manageTab = control.dataset.manage;
    render();
    app.querySelector('[data-manage][aria-pressed="true"]')?.focus({ preventScroll: true });
  } else if (control.dataset.command && !saving) {
    saving = control.disabled = true;
    try {
      if (control.dataset.command === "export-backup" && localLeague) {
        const url = URL.createObjectURL(new Blob([localLeague.exportBackup()], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "fantasyscout-108-copia.json";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (control.dataset.command === "logout") {
        await request("/api/logout", "POST", {});
        resetRoute();
      }
      await reload();
      render();
    } catch (error) {
      alertUser(error.message, true);
    } finally {
      saving = control.disabled = false;
    }
  }
});

window.addEventListener("hashchange", () => {
  if (state?.viewer && location.hash !== "#main") {
    render();
    document.querySelector("#main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
});

start();
