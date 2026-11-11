const app = document.querySelector("#app");
const notice = document.querySelector("#notice");
const localLeague = window.fantasyScoutLocal ?? null;
const dates = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Madrid" });
const euro = new Intl.NumberFormat("es-ES", {
  style: "currency", currency: "EUR", useGrouping: "always", trailingZeroDisplay: "stripIfInteger",
});
const labels = { planned: "Programada", open: "Plantillas abiertas", scoring: "En puntuación", closed: "Cerrada" };
const routes = { inicio: "Inicio", alineacion: "Alineación", mercado: "Mercado", clasificacion: "Clasificación", jornadas: "Semanas", monitores: "Monitores", gestion: "Gestión" };
const organizationRoutes = ["inicio", "mercado", "clasificacion", "jornadas", "monitores", "gestion"];
const managerRoutes = ["alineacion", "mercado", "clasificacion"];
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
let authMode = "register";
let manageTab = "rounds";
let lineupRound = 0;
let lineupEditing = false;
let setupRound;
let reviewRound;
let reviewSection = 0;
let reviewMonitor;
let marketQuery = "";
let marketSection = 0;
let saving = false;
let noticeTimer;
let currentRoute = "inicio";

const isAdmin = () => state.viewer?.role === "admin";
const canReview = () => isAdmin() || Boolean(state.viewer?.reviewIds.length);
const navigation = () => isAdmin() ? organizationRoutes : managerRoutes;
const me = () => state.viewer?.player;
const editingRoster = () => currentRoute === "alineacion" && lineupEditing && Boolean(me());
const localView = () => isAdmin() ? "admin" : "player";
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

function sectionOptions(selectedId) {
  return '<option value="">Elige una sección</option>' + state.sections.map(({ id, name }) =>
    `<option value="${id}"${choose(id, selectedId)}>${h(name)}</option>`).join("");
}

function marketValueDecimal(cents) {
  const digits = String(cents).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function marketValueField(id, cents) {
  const value = marketValueDecimal(cents).replace(/\.00$/, "").replace(".", ",");
  return `<div class="field"><label for="${id}">Valor de mercado (€)</label>
    <input id="${id}" name="marketValue" inputmode="decimal" value="${value}" autocomplete="off" required>
  </div>`;
}

function parseMarketValue(euros) {
  const text = euros.trim();
  const amount = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text) ? text.replaceAll(".", "") : text;
  const parts = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(amount);
  const cents = parts && Number(parts[1] + (parts[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Introduce un valor en euros igual o superior a cero, con hasta dos decimales.");
  }
  return cents;
}

function brand(link = true) {
  const tag = link ? "a" : "div";
  const href = link ? ` href="#${navigation()[0]}" data-route` : "";
  return `<${tag} class="brand"${href}>
    <span class="mark" aria-hidden="true"></span>
    <span><span class="brand-name">FantasyScout</span><span class="brand-group">Grupo 108 · Lorca</span></span>
  </${tag}>`;
}

function authShell(content) {
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
        ${state.storageWarning ? `<p class="local-warning" role="status">${h(state.storageWarning)}</p>` : ""}
        ${content}
      </div>
    </section>
  </main>`;
}

const aliasField = '<div class="field"><label for="alias">Alias</label><input id="alias" name="alias" autocomplete="username" maxlength="32" required></div>';

function teamFields(selectedSection) {
  return `<div class="field"><label for="team">Nombre de tu equipo</label><input id="team" name="team" maxlength="52" required></div>
    <div class="field"><label for="join-section">Sección del mánager</label>
      <select id="join-section" name="sectionId" required>${sectionOptions(selectedSection)}</select>
    </div>`;
}

function localEntry() {
  if (authMode === "admin") {
    return `<h2>Acceso de organización</h2>
      <form class="form" data-form="admin-login">
        <div class="field"><label for="password">Contraseña de Organización</label>
          <input id="password" name="password" type="password" inputmode="numeric" autocomplete="current-password" maxlength="11" required>
        </div>
        ${errorRegion}<button class="button primary" type="submit">Entrar en Organización</button>
      </form>
      <p class="auth-link"><button type="button" class="link-button" data-auth="register">Volver a Vista usuario</button></p>`;
  }
  if (authMode === "existing" && state.players.length) {
    return `<h2>Elige tu equipo guardado</h2>
      <form class="form" data-form="local-team">
        <div class="field"><label for="saved-team">Equipo</label>
          <select id="saved-team" name="playerId" required><option value="">Elige tu equipo</option>
            ${state.players.map(({ id, alias, team }) => `<option value="${id}">${h(team)} · ${h(alias)}</option>`).join("")}
          </select>
        </div>
        ${errorRegion}<button class="button primary" type="submit">Entrar en mi equipo</button>
      </form>
      <p class="auth-link"><button type="button" class="link-button" data-auth="register">Volver a crear equipo</button></p>`;
  }
  const section = state.sections.length === 1 ? state.sections[0].id : undefined;
  return `<h2>Crea tu equipo</h2><p class="muted">Tu equipo se guarda en este navegador.</p>
    <form class="form" data-form="register">
      ${aliasField}${teamFields(section)}
      ${errorRegion}<button class="button primary" type="submit">Crear mi equipo</button>
    </form>
    <p class="auth-link form-actions">
      ${state.players.length ? '<button type="button" class="link-button" data-auth="existing">Usar un equipo guardado</button>' : ""}
      <button type="button" class="link-button" data-auth="admin">Acceso de organización</button>
    </p>`;
}

function authScreen() {
  if (localLeague) return authShell(localEntry());
  const joining = authMode === "register";
  const organizing = authMode === "admin";
  const title = joining ? "Inscribirme en la liga" : organizing ? "Acceso de organización" : "Entra en tu equipo";
  const intro = joining ? "Usa el código que comparta la organización del grupo."
    : organizing ? "Gestiona monitores, semanas y puntuaciones." : "Accede con el alias que elegiste al inscribirte.";
  const formName = joining ? "register" : organizing ? "admin-login" : "login";
  return authShell(`<h2>${title}</h2><p class="muted">${intro}</p>
        ${organizing ? "" : `<div class="auth-switch" aria-label="Acceso a la liga">
          <button type="button" data-auth="login" aria-pressed="${!joining}">Entrar</button>
          <button type="button" data-auth="register" aria-pressed="${joining}">Inscribirme</button>
        </div>`}
        <form class="form" data-form="${formName}">
          ${organizing ? "" : aliasField}
          ${joining ? teamFields() : ""}
          <div class="field"><label for="password">${organizing ? "Clave de organización" : "Contraseña"}</label>
            <input id="password" name="password" type="password" autocomplete="${joining ? "new-password" : "current-password"}" minlength="${organizing ? 12 : 8}" maxlength="128" required>
          </div>
          ${joining ? '<div class="field"><label for="invite">Código de invitación</label><input id="invite" name="inviteCode" autocomplete="off" maxlength="128" required></div>' : ""}
          ${errorRegion}
          <button class="button primary" type="submit">${joining ? "Crear mi equipo" : "Entrar"}</button>
        </form>
        <p class="auth-link"><button type="button" class="link-button" data-auth="${organizing ? "login" : "admin"}">
          ${organizing ? "Volver al acceso de mánagers" : "Acceso de organización"}</button></p>
    `);
}

function roundStatus(round) {
  return `<span class="pill ${round.status}">${labels[round.status]}</span>`;
}

function roundDate(round) {
  return round.date ? `<time class="round-date" datetime="${h(round.date)}">${dates.format(new Date(`${round.date}T12:00:00Z`))}</time>` : "";
}

function topBar() {
  const selectedView = localView();
  const account = localLeague ? `<div class="local-account">
    <label for="local-view">Vista local</label>
    <select id="local-view" data-select="local-view">
      <option value="player"${choose("player", selectedView)}>Vista usuario</option>
      <option value="admin"${choose("admin", selectedView)}>Organización</option>
    </select>
  </div>` : `<div class="account"><span>${isAdmin() ? "Organización" : h(me().alias)}</span>
    <button type="button" class="button secondary" data-command="logout">Salir</button>
  </div>`;
  const review = !isAdmin() && canReview()
    ? '<a class="button secondary" href="#gestion" data-route>Puntuar sección</a>' : "";
  return `<header class="topbar"><div class="topbar-inner">
    ${brand()}
    <nav class="main-nav" aria-label="Navegación principal">
      ${navigation().map((key) => `<a href="#${key}" data-route${key === currentRoute ? ' aria-current="page"' : ""}>${routes[key]}</a>`).join("")}
    </nav>
    <div class="view-controls">${account}${review}</div>
  </div></header>`;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0]).join("");
}

function personLine(title, detail) {
  return `<div class="person-line"><span class="avatar" aria-hidden="true">${h(initials(title))}</span>
    <span class="person-copy"><strong>${h(title)}</strong><small>${h(detail)}</small></span></div>`;
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
  const needsMonitors = state.monitors.length === 0;
  const needsTeams = localLeague && state.players.length === 0;
  const preparing = needsMonitors || needsTeams;
  const title = preparing ? "Prepara tu liga" : `Semana ${round.id}`;
  const description = needsMonitors ? "Registra a los monitores de cada sección para que los mánagers puedan ficharlos."
    : needsTeams ? "Inscríbete como mánager y añade los equipos de las demás personas."
      : round.challenge || "Consulta las plantillas y los puntos de esta semana.";
  const action = needsMonitors ? '<a class="button accent" href="#monitores" data-route>Registrar monitores</a>'
    : needsTeams ? '<a class="button accent" href="#gestion" data-route data-panel="players">Inscribir equipos</a>'
      : '<a class="button accent" href="#gestion" data-route data-panel="rounds">Gestionar semana</a>';
  const classification = `<section class="card">
    <div class="card-head"><h2>Clasificación</h2><a href="#clasificacion" data-route class="link-button">Ver tabla</a></div>
    ${topFive()}
  </section>`;
  return `<section class="hero"><div class="hero-content">
    <div class="hero-meta">${preparing ? '<span class="eyebrow">FantasyScout 108</span>' : roundStatus(round)}</div>
    <h1>${title}</h1><p>${h(description)}</p>${action}
  </div></section>
  <section class="stat-grid" aria-label="Datos de la liga">
    ${stat("Equipos inscritos", state.players.length)}
    ${stat("Monitores registrados", state.monitors.length)}
    ${stat("Semanas cerradas", `${state.rounds.filter(({ status }) => status === "closed").length}/${state.rounds.length}`)}
  </section>
  ${classification}`;
}

function pageHead(title, description, action = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p class="muted">${description}</p></div>${action}</div>`;
}

function roundSelect(id, value, currentLabel = "") {
  return `<div class="field"><label for="${id}">${currentLabel ? "Ver alineación" : "Semana"}</label>
    <select id="${id}" data-select="${id}">
      ${currentLabel ? `<option value="0"${choose(0, value)}>${h(currentLabel)}</option>` : ""}
      ${state.rounds.map((round) =>
      `<option value="${round.id}"${choose(round.id, value)}>Semana ${round.id} · ${labels[round.status]}</option>`).join("")}</select>
  </div>`;
}

function lastScoredRound() {
  const scoredWeeks = new Set(state.monitorPoints.map(({ roundId }) => roundId));
  return state.rounds.findLast(({ id }) => scoredWeeks.has(id));
}

function lineupPitch(members, capacity, scoreRound) {
  const scores = new Map(state.monitorPoints.filter(({ roundId }) => roundId === scoreRound?.id)
    .map(({ monitorId, points }) => [monitorId, points]));
  const slots = Array.from({ length: capacity }, (_, index) => members[index]);
  const rows = [];
  const rowSize = capacity <= 6 ? 2 : 4;
  if (capacity >= 3 && capacity <= 12) rows.push(slots.splice(0, 1));
  while (slots.length) rows.push(slots.splice(0, rowSize));

  return `<section class="lineup-pitch" aria-label="Alineación en el campo">
    <div class="pitch-lines" aria-hidden="true"><span class="pitch-area top"></span>
      <span class="pitch-middle"></span><span class="pitch-area bottom"></span></div>
    ${rows.map((row) => `<ul class="pitch-row">${row.map((monitor) => {
      if (!monitor) return '<li class="pitch-slot vacant"><span aria-hidden="true">+</span><small>Libre</small></li>';
      const points = scores.get(monitor.id) ?? (scoreRound?.status === "closed" ? 0 : undefined);
      return `<li class="pitch-slot">
        <div class="pitch-avatar"><span aria-hidden="true">${h(initials(monitor.name))}</span>
          ${points === undefined ? "" : `<small class="pitch-score">${points} pt</small>`}
        </div>
        <strong class="pitch-name" title="${h(monitor.name)}">${h(monitor.name)}</strong>
      </li>`;
    }).join("")}</ul>`).join("")}
    ${capacity ? "" : '<p class="pitch-empty">La plantilla de esta semana está vacía.</p>'}
  </section>`;
}

function lineupPage() {
  const player = me();
  const round = state.rounds.find(({ id }) => id === lineupRound);
  const locked = round && isWeekLocked(round);
  const members = (round ? myWeeklyRoster(round) : state.roster).map(monitorFor).filter(Boolean);
  const capacity = locked ? members.length : state.rosterSize;
  const scoreRound = round ?? lastScoredRound();
  const standing = myStanding();
  const result = standing?.results.find(({ roundId }) => roundId === round?.id);
  const value = members.reduce((total, { marketValueCents }) => total + BigInt(marketValueCents), 0n);
  const edit = `<button id="lineup-edit" type="button" class="button ${lineupEditing ? "secondary" : "accent"}"
    data-command="edit-lineup" aria-expanded="${lineupEditing}" aria-controls="lineup-content">
    ${lineupEditing ? "Volver al campo" : "Editar plantilla"}
  </button>`;
  const toolbar = `<div class="lineup-toolbar">
    ${roundSelect("lineup-round", lineupRound, "Plantilla actual")}
    ${round ? `<div class="round-meta">${roundStatus(round)}${roundDate(round)}</div>`
      : scoreRound ? `<p class="hint">Puntos individuales · Semana ${scoreRound.id}</p>` : ""}
  </div>`;

  return `${pageHead("Alineación", h(player.team), edit)}
    <dl class="lineup-stats" aria-label="Datos de la alineación">
      <div><dt>Monitores</dt><dd>${members.length}${locked ? "" : ` / ${capacity}`}</dd></div>
      <div><dt>Valor del equipo</dt><dd>${euro.format(marketValueDecimal(value))}</dd></div>
      <div><dt>${round ? `Puntos semana ${round.id}` : "Puntos totales"}</dt>
        <dd>${round ? (result?.scored ? result.total : "—") : standing?.total ?? 0}</dd></div>
    </dl>
    <div id="lineup-content" class="lineup-content">
      ${lineupEditing ? marketPanel() : toolbar + lineupPitch(members, capacity, scoreRound)}
    </div>`;
}

function searchName(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
}

function marketResults() {
  const query = searchName(marketQuery.trim());
  const monitors = state.monitors.filter(({ name, sectionId }) =>
    (!marketSection || sectionId === marketSection) && searchName(name).includes(query));
  if (!monitors.length) return '<p class="empty" role="status">Ningún monitor coincide con la búsqueda.</p>';

  const week = lastScoredRound();
  const weekLabel = week ? `Semana ${week.id}` : "Última semana";
  const weekly = new Map();
  const totals = new Map();
  for (const { roundId, monitorId, points } of state.monitorPoints) {
    if (roundId === week?.id) weekly.set(monitorId, points);
    totals.set(monitorId, (totals.get(monitorId) ?? 0) + points);
  }
  const total = (id) => totals.get(id) ?? 0;
  monitors.sort((a, b) => total(b.id) - total(a.id) || a.name.localeCompare(b.name, "es"));
  const roster = new Set(state.roster);
  const full = roster.size >= state.rosterSize;
  const showActions = editingRoster();

  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Monitores del mercado">
    <table class="market-table" role="table"><thead role="rowgroup"><tr role="row">
      <th scope="col" role="columnheader">Monitor</th>
      <th scope="col" role="columnheader" class="num">Valor</th>
      <th scope="col" role="columnheader" class="num">${weekLabel}</th>
      <th scope="col" role="columnheader" class="num">Total</th>
      ${showActions ? '<th scope="col" role="columnheader" class="num">Plantilla</th>' : ""}
    </tr></thead><tbody role="rowgroup">${monitors.map(({ id, name, sectionId, marketValueCents }) => {
      const points = weekly.get(id) ?? (week?.status === "closed" ? 0 : undefined);
      const signed = showActions && roster.has(id);
      const label = signed ? "Liberar" : "Fichar";
      return `<tr role="row"${signed ? ' class="active-row"' : ""}>
        <th scope="row" role="rowheader" class="market-monitor">${personLine(name, sectionName(sectionId))}</th>
        <td role="cell" class="num market-value">${euro.format(marketValueDecimal(marketValueCents))}</td>
        <td role="cell" class="num market-week"><span class="market-mobile-label" aria-hidden="true">${weekLabel}</span>
          ${points === undefined ? "—" : `${points} pt`}</td>
        <td role="cell" class="num points market-total"><span class="market-mobile-label" aria-hidden="true">Total</span>${total(id)} pt</td>
        ${showActions ? `<td role="cell" class="market-action">
          <form data-form="market-transfer" data-id="${id}" data-move="${signed ? "release" : "sign"}">
            <button id="market-action-${id}" class="button ${signed ? "secondary" : "primary"}" type="submit"
              aria-label="${label} a ${h(name)}"${!signed && full ? ' disabled aria-describedby="market-full"' : ""}>${label}</button>
            ${errorRegion}
          </form>
        </td>` : ""}
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

function marketPanel() {
  const full = state.roster.length >= state.rosterSize;
  if (!state.sections.some(({ id }) => id === marketSection)) marketSection = 0;
  return `<section class="card table-card" aria-label="Mercado de monitores">
      ${state.monitors.length ? `<div class="market-controls">
        <div class="field"><label for="market-search">Buscar monitor</label>
          <input id="market-search" type="search" value="${h(marketQuery)}" autocomplete="off">
        </div>
        <div class="field"><label for="market-section">Sección</label>
          <select id="market-section" data-select="market-section">
            <option value="0">Todas las secciones</option>
            ${state.sections.map(({ id, name }) => `<option value="${id}"${choose(id, marketSection)}>${h(name)}</option>`).join("")}
          </select>
        </div>
        ${editingRoster() ? `<p class="market-places"><span class="pill ${full ? "" : "open"}">${state.roster.length} de ${state.rosterSize} plazas ocupadas</span>
          ${full ? '<small id="market-full">Libera una plaza para fichar.</small>' : ""}</p>` : ""}
      </div><div id="market-results">${marketResults()}</div>`
      : '<p class="empty">Los monitores aparecerán aquí cuando se registren.</p>'}
    </section>`;
}

function marketPage() {
  let action = refreshButton;
  if (isAdmin()) {
    action = state.monitors.length ? `<div class="form-actions">${refreshButton}
      <a class="button secondary" href="#monitores" data-route>Editar valores</a></div>`
      : '<a class="button primary" href="#monitores" data-route>Registrar monitores</a>';
  }
  return pageHead("Mercado", "Consulta el valor y los puntos de los monitores de todo el grupo.", action) + marketPanel();
}

function standingsPage() {
  const totalColumn = '<th scope="col" class="num">Total</th>';
  const user = Boolean(me());
  return `${pageHead("Clasificación", "Cada semana suma los puntos de los monitores de la plantilla. En empate, los equipos comparten puesto.", refreshButton)}
    <section class="card table-card">${state.standings.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla de clasificación">
      <table><thead><tr><th scope="col">Puesto</th><th scope="col">Equipo</th>${user ? totalColumn : ""}
        ${state.rounds.map(({ id }) => `<th scope="col" class="num" aria-label="Semana ${id}">S${id}</th>`).join("")}
        ${user ? "" : totalColumn}
      </tr></thead><tbody>${state.standings.map((row) => {
        const total = `<td class="num points">${row.total}</td>`;
        return `<tr${row.id === me()?.id ? ' class="active-row"' : ""}>
          <td class="rank">${hasResults(row) ? row.rank : "—"}</td>
          <th scope="row">${personLine(row.team, row.alias)}</th>${user ? total : ""}
          ${row.results.map((result) => `<td class="num">${result.scored ? result.total : "—"}</td>`).join("")}
          ${user ? "" : total}
        </tr>`;
      }).join("")}</tbody></table>
    </div>` : '<p class="empty">Los equipos aparecerán cuando se inscriban sus mánagers.</p>'}</section>`;
}

function roundsPage() {
  return `${pageHead("Semanas", "Consulta el calendario y la fase de cada semana.")}
    <div class="round-grid">${state.rounds.map((round) => `<article class="card round-card">
      <div class="card-head"><h2>Semana ${round.id}</h2>${roundStatus(round)}</div>
      ${roundDate(round)}${round.challenge ? `<p>${h(round.challenge)}</p>` : ""}
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

function monitorRegisterPage() {
  const monitors = [...state.monitors].sort((a, b) => a.name.localeCompare(b.name, "es") || a.sectionId - b.sectionId);
  const organization = isAdmin();
  const canSaveCopy = localLeague && organization;
  const defaultSection = state.sections.length === 1 ? state.sections[0].id : undefined;
  const description = localLeague && !isAdmin()
    ? "En Vista local, elige Organización para registrar un monitor."
    : canSaveCopy && !state.storageWarning ? "El registro se guarda en este navegador." : "Monitores disponibles para las plantillas.";
  const download = canSaveCopy && monitors.length
    ? '<button class="button secondary" type="button" data-command="export-monitors">Descargar registro</button>' : "";
  const list = `<section class="card table-card">
    ${monitors.length ? `<div class="table-wrap"><table aria-label="Registro de monitores">
      <thead><tr><th scope="col">Nombre</th><th scope="col">Sección</th><th scope="col" class="num">Valor de mercado</th></tr></thead>
      <tbody>${monitors.map(({ id, name, sectionId, marketValueCents }) => `<tr>
        <th scope="row">${h(name)}</th><td>${h(sectionName(sectionId))}</td>
        <td class="num"><strong class="market-value">${euro.format(marketValueDecimal(marketValueCents))}</strong>
          ${organization ? `<details class="monitor-value-editor">
            <summary id="edit-monitor-${id}" aria-label="Editar valor de ${h(name)}">Editar valor</summary>
            <form class="form" data-form="edit-monitor-value" data-id="${id}">
              ${marketValueField(`monitor-value-${id}`, marketValueCents)}
              ${errorRegion}<button class="button secondary" type="submit">Guardar valor</button>
            </form>
          </details>` : ""}
        </td>
      </tr>`).join("")}</tbody>
    </table></div>` : '<p class="empty">El registro está vacío.</p>'}
  </section>`;
  return `${pageHead("Monitores registrados", description, download)}
  ${organization ? `<div class="manage-grid">
    ${list}
    <section class="card">
      <h2>Registrar monitor</h2>
      <form class="form" data-form="add-monitor">
        <div class="field"><label for="monitor-name">Nombre del monitor</label><input id="monitor-name" name="name" maxlength="60" required></div>
        <div class="field"><label for="monitor-section">Sección del monitor</label><select id="monitor-section" name="sectionId" required>${sectionOptions(defaultSection)}</select></div>
        ${marketValueField("new-monitor-value", state.defaultMarketValueCents)}
        ${errorRegion}<button class="button primary" type="submit">Registrar monitor</button>
      </form>
    </section>
  </div>` : list}
  ${canSaveCopy ? `<section class="card">
    <div class="card-head"><h2>Importar monitores</h2></div>
    <form class="form" data-form="import-monitors">
      <p class="hint">Carga un registro de monitores o una copia de FantasyScout para añadir los monitores que falten.</p>
      <div class="field"><label for="monitor-register">Archivo JSON</label>
        <input id="monitor-register" name="copy" type="file" accept=".json,application/json" required>
      </div>
      ${errorRegion}<button class="button secondary" type="submit">Importar registro</button>
    </form>
  </section>` : ""}`;
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
    rounds: manageRounds, scores: manageScores, sections: manageSections,
    players: managePlayers, backup: manageBackup,
  };
  return `${pageHead("Gestión", isAdmin() ? "Organiza las semanas y registra el rendimiento de los monitores." : "Registra las aportaciones de tu sección.")}
    ${isAdmin() ? `<div class="segmented" aria-label="Panel de gestión">${tabs.map(([key, label]) =>
      key === "monitors" ? '<a href="#monitores" data-route>Monitores</a>'
        : `<button type="button" data-manage="${key}" aria-pressed="${panel === key}">${label}</button>`).join("")}</div>` : ""}
    ${panels[panel]()}`;
}

function render() {
  if (!state.viewer || (localLeague && authMode === "admin")) {
    app.innerHTML = authScreen();
    return;
  }
  const requested = location.hash.slice(1);
  const target = requested === "main" ? currentRoute : requested;
  const tabs = navigation();
  currentRoute = tabs.includes(target) || (target === "gestion" && canReview()) ? target : tabs[0];
  if (currentRoute !== "alineacion") lineupEditing = false;
  const pages = {
    inicio: home, alineacion: lineupPage, mercado: marketPage, clasificacion: standingsPage, jornadas: roundsPage,
    monitores: monitorRegisterPage, gestion: managementPage,
  };
  const storageWarning = state.storageWarning ? `<p class="local-warning" role="status">${h(state.storageWarning)}</p>` : "";
  const content = `${topBar()}<main class="workspace" id="main" tabindex="-1">${storageWarning}${pages[currentRoute]()}</main>`;
  app.innerHTML = isAdmin() ? `${content}<footer class="footer">Grupo Scout Ciudad del Sol 108</footer>`
    : `<div class="manager-view">${content}</div>`;
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
  currentRoute = navigation()[0];
  authMode = "login";
  manageTab = "rounds";
  setupRound = reviewRound = reviewMonitor = undefined;
  lineupRound = 0;
  lineupEditing = false;
  reviewSection = 0;
  marketQuery = "";
  marketSection = 0;
  history.replaceState(null, "", `#${currentRoute}`);
}

const actions = {
  login: ({ alias, password }) => ["/api/login", "POST", { alias, password }],
  "admin-login": ({ password }) => ["/api/login", "POST", { role: "admin", password }],
  register: (values) => ["/api/register", "POST", { ...values, sectionId: Number(values.sectionId) }, "Equipo inscrito."],
  "local-team": ({ playerId }) => ["/api/local/team", "POST", { playerId: Number(playerId) }],
  "market-transfer": (_, { dataset }) => ["/api/roster", "PATCH",
    { monitorId: Number(dataset.id), action: dataset.move }, dataset.move === "sign" ? "Monitor fichado." : "Plaza liberada."],
  round: (values, form) => [`/api/admin/rounds/${form.dataset.id}`, "PATCH", values, "Calendario guardado."],
  "add-round": (values) => ["/api/admin/rounds", "POST", values, "Semana añadida."],
  phase: (_, form) => [`/api/admin/rounds/${form.dataset.id}`, "PATCH", { action: form.dataset.action }, "Fase actualizada."],
  "add-player": ({ alias, team, sectionId }) => ["/api/admin/players", "POST", { alias, team, sectionId: Number(sectionId) }, "Equipo inscrito."],
  "add-monitor": ({ name, sectionId, marketValue }) => ["/api/admin/monitors", "POST",
    { name, sectionId: Number(sectionId), marketValueCents: parseMarketValue(marketValue) }, "Monitor registrado."],
  "edit-monitor-value": ({ marketValue }, form) => [`/api/admin/monitors/${form.dataset.id}`, "PATCH",
    { marketValueCents: parseMarketValue(marketValue) }, "Valor de mercado guardado."],
  settings: ({ rosterSize }) => ["/api/admin/settings", "PATCH", { rosterSize: Number(rosterSize) }, "Límite actualizado."],
  "add-section": (values) => ["/api/admin/sections", "POST", values, "Sección añadida."],
  "edit-section": ({ name, reviewerId }, form) => [`/api/admin/sections/${form.dataset.id}`, "PATCH",
    { name, reviewerId: reviewerId ? Number(reviewerId) : null }, "Sección guardada."],
  score: ({ note }, form, data) => [`/api/rounds/${form.dataset.id}/scores/${form.dataset.monitor}`, "PUT",
    { categories: data.getAll("category"), note }, "Puntuación guardada."],
};

async function saveForm(form, button) {
  const formName = form.dataset.form;
  const action = actions[formName];
  const entry = ["login", "admin-login", "register", "local-team"].includes(formName);
  const importing = localLeague && ["import-backup", "import-monitors"].includes(formName);
  if ((!action && !importing) || saving) return;
  const errorBox = form.querySelector("[data-error]");
  if (!form.reportValidity()) {
    const label = form.querySelector(":invalid")?.labels?.[0]?.textContent.trim();
    errorBox.textContent = label ? `Revisa el campo «${label}».` : "Revisa los campos del formulario.";
    errorBox.hidden = false;
    return;
  }
  saving = button.disabled = true;
  errorBox.hidden = true;
  try {
    const data = new FormData(form);
    let message;
    if (importing) {
      const copy = data.get("copy");
      if (!copy?.size || copy.size > 2 * 1024 * 1024) throw new Error("Elige una copia JSON de hasta 2 MB.");
      const contents = await copy.text();
      if (formName === "import-monitors") {
        const added = await localLeague.importMonitorRegister(contents);
        message = added === 1 ? "1 monitor añadido." : `${added} monitores añadidos.`;
      } else {
        await localLeague.importBackup(contents);
        message = "Copia cargada.";
      }
    } else {
      const [path, method, body, feedback] = action(Object.fromEntries(data), form, data);
      await request(path, method, body);
      message = feedback;
    }
    await reload();
    if (formName === "add-monitor" && state.storageWarning) message = "Monitor añadido a esta sesión. Descarga el registro para conservarlo.";
    if (formName === "edit-monitor-value" && state.storageWarning) {
      message = "Valor actualizado en esta sesión. Descarga el registro para conservarlo.";
    }
    if (entry) resetRoute();
    render();
    if (formName === "add-monitor" && currentRoute === "monitores") {
      document.getElementById("monitor-name")?.focus({ preventScroll: true });
    }
    if (formName === "edit-monitor-value" && currentRoute === "monitores") {
      document.getElementById(`edit-monitor-${form.dataset.id}`)?.focus({ preventScroll: true });
    }
    if (formName === "market-transfer" && currentRoute === "alineacion") {
      const next = document.getElementById(`market-action-${form.dataset.id}`);
      (next?.disabled ? document.getElementById("market-search") : next)?.focus({ preventScroll: true });
    }
    if (message) alertUser(message);
  } catch (error) {
    if (error.status === 401 && state.viewer && !entry) {
      await start();
      alertUser(error.message, true);
    } else if (form.isConnected) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } else {
      alertUser(error.message, true);
    }
  } finally {
    saving = button.disabled = false;
  }
}

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const button = event.submitter ?? form.querySelector('button[type="submit"]');
  if (button) void saveForm(form, button);
});

app.addEventListener("keydown", (event) => {
  if (!localLeague || event.key !== "Enter" || event.isComposing || event.repeat) return;
  const input = event.target;
  if (input.tagName !== "INPUT" || !["text", "number", "date", "password"].includes(input.type) || !input.form?.dataset.form) return;
  const button = input.form.querySelector('button[type="submit"]');
  if (!button) return;
  event.preventDefault();
  button.click();
});

app.addEventListener("input", (event) => {
  if (event.target.id !== "market-search") return;
  marketQuery = event.target.value;
  document.getElementById("market-results").innerHTML = marketResults();
});

app.addEventListener("change", async (event) => {
  const control = event.target;
  if (control.dataset.select === "local-view" && localLeague) {
    if (saving) {
      control.value = localView();
      return;
    }
    if (control.value === localView()) return;
    if (control.value === "admin") {
      authMode = "admin";
      render();
      document.getElementById("password")?.focus();
      return;
    }
    saving = control.disabled = true;
    try {
      await request("/api/logout", "POST");
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
  if (control.name === "category") {
    const points = Array.from(control.form.querySelectorAll('input[name="category"]:checked'))
      .reduce((sum, checked) => sum + Number(checked.dataset.value), 0);
    control.closest("section").querySelector("[data-points]").textContent = `${points} pt`;
    return;
  }
  const value = Number(control.value);
  switch (control.dataset.select) {
    case "market-section":
      marketSection = value;
      document.getElementById("market-results").innerHTML = marketResults();
      return;
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

function downloadJson(contents, name) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener("click", async (event) => {
  const control = event.target.closest("button, a");
  if (!control) return;
  if (localLeague && control.type === "submit" && control.form?.dataset.form) {
    event.preventDefault();
    await saveForm(control.form, control);
    return;
  }
  if (control.hasAttribute("data-route")) {
    if (control.dataset.panel) manageTab = control.dataset.panel;
    if (control.getAttribute("href") === location.hash) render();
  } else if (control.dataset.auth && !saving) {
    authMode = control.dataset.auth;
    render();
    app.querySelector("input")?.focus();
  } else if (control.dataset.manage) {
    manageTab = control.dataset.manage;
    render();
    app.querySelector('[data-manage][aria-pressed="true"]')?.focus({ preventScroll: true });
  } else if (control.dataset.command === "edit-lineup" && me() && !saving) {
    lineupEditing = !lineupEditing;
    if (lineupEditing) lineupRound = 0;
    render();
    document.getElementById("lineup-edit")?.focus({ preventScroll: true });
  } else if (control.dataset.command && !saving) {
    saving = control.disabled = true;
    try {
      if (control.dataset.command === "export-backup" && localLeague) {
        downloadJson(localLeague.exportBackup(), "fantasyscout-108-copia.json");
        return;
      }
      if (control.dataset.command === "export-monitors" && localLeague) {
        downloadJson(localLeague.exportMonitorRegister(), "fantasyscout-monitores.json");
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
