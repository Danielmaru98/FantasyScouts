const app = document.querySelector("#app");
const notice = document.querySelector("#notice");
const dates = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Madrid" });
const labels = { planned: "Programada", open: "Fichajes abiertos", scoring: "En puntuación", closed: "Cerrada" };
const routes = { inicio: "Inicio", alineacion: "Alineación", clasificacion: "Clasificación", jornadas: "Jornadas", gestion: "Gestión" };
const transition = {
  planned: { action: "open", label: "Abrir fichajes", hint: "Los scouters podrán guardar su alineación." },
  open: { action: "lock", label: "Cerrar fichajes", hint: "La alineación queda fijada y se abre el registro de puntos." },
  scoring: { action: "close", label: "Cerrar jornada", hint: "Comprueba las aportaciones antes de cerrar." },
  closed: { action: "reopen", label: "Reabrir puntuación", hint: "Podrás corregir aportaciones de la jornada." },
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
let reviewPlayer;
let saving = false;
let noticeTimer;
let currentRoute = "inicio";

const isAdmin = () => state.viewer?.role === "admin";
const canReview = () => isAdmin() || Boolean(state.viewer?.reviewIds.length);
const me = () => state.viewer?.player;
const sectionName = (id) => state.sections.find((section) => section.id === id)?.name ?? "Sección";
const player = (id) => state.players.find((person) => person.id === id);
const myStanding = () => state.standings.find((entry) => entry.id === me()?.id);
const myLineup = (id) => state.lineups.find((entry) => entry.roundId === id);
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
    : organizing ? "Gestiona secciones, jornadas y puntuaciones." : "Accede con el alias que elegiste al inscribirte.";
  const formName = joining ? "register" : organizing ? "admin-login" : "login";
  return `<main class="auth-shell" id="main" tabindex="-1">
    <section class="auth-story">
      ${brand(false)}
      <div class="story-copy">
        <p class="eyebrow">Grupo Scout Ciudad del Sol 108</p>
        <h1>FantasyScout</h1>
        <p>Forma tu equipo con scouters del grupo y suma puntos por lo que hacéis en cada jornada.</p>
      </div>
      <div class="story-facts"><span><strong>4</strong> jornadas</span><span><strong>2</strong> fichajes por equipo</span></div>
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
          <div class="field"><label for="join-section">Sección</label><select id="join-section" name="sectionId" required>
            <option value="">Elige tu sección</option>
            ${state.sections.map(({ id, name }) => `<option value="${id}">${h(name)}</option>`).join("")}
          </select></div>` : ""}
          <div class="field"><label for="password">${organizing ? "Clave de organización" : "Contraseña"}</label>
            <input id="password" name="password" type="password" autocomplete="${joining ? "new-password" : "current-password"}" minlength="${organizing ? 12 : 8}" maxlength="128" required>
          </div>
          ${joining ? '<div class="field"><label for="invite">Código de invitación</label><input id="invite" name="inviteCode" autocomplete="off" maxlength="128" required></div>' : ""}
          ${errorRegion}
          <button class="button primary" type="submit">${joining ? "Crear mi equipo" : "Entrar"}</button>
        </form>
        <p class="auth-link"><button type="button" class="link-button" data-auth="${organizing ? "login" : "admin"}">
          ${organizing ? "Volver al acceso de scouters" : "Acceso de organización"}</button></p>
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
  return `<header class="topbar"><div class="topbar-inner">
    ${brand()}
    <nav class="main-nav" aria-label="Navegación principal">
      ${tabs.map(([key, label]) => `<a href="#${key}" data-route${key === currentRoute ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
    <div class="account"><span>${isAdmin() ? "Organización" : h(me().alias)}</span>
      <button type="button" class="button secondary" data-command="logout">Salir</button>
    </div>
  </div></header>`;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0]).join("");
}

function personLine(title, detail) {
  return `<div class="person-line"><span class="avatar" aria-hidden="true">${h(initials(title))}</span>
    <span class="person-copy"><strong>${h(title)}</strong><small>${h(detail)}</small></span></div>`;
}

function personSlot(person, label) {
  return `<li>${person ? personLine(person.alias, sectionName(person.sectionId)) : '<span class="hint">Fichaje pendiente</span>'}
    <span class="person-slot">${label}</span></li>`;
}

function lineupSummary(round) {
  const lineup = myLineup(round.id);
  return `<ul class="person-list">
    ${personSlot(me(), "Mánager")}
    ${personSlot(player(lineup?.firstPickId), "Fichaje 1")}
    ${personSlot(player(lineup?.secondPickId), "Fichaje 2")}
  </ul>`;
}

function stat(label, value) {
  return `<div class="card stat"><strong>${h(value)}</strong><span>${label}</span></div>`;
}

function topFive() {
  if (!state.standings.length) return '<p class="empty">Los equipos aparecerán cuando se inscriban los scouters.</p>';
  return `<ol class="leader-list">${state.standings.slice(0, 5).map((row) => `<li>
    <span class="rank">${hasResults(row) ? row.rank : "—"}</span>
    ${personLine(row.team, `${row.alias} · ${sectionName(row.sectionId)}`)}
    <span class="points">${row.total} pt</span>
  </li>`).join("")}</ol>`;
}

function home() {
  const round = activeRound();
  const own = myStanding();
  const openForPlayer = round.status === "open" && !isAdmin();
  const title = openForPlayer ? "Elige tus fichajes" : `Jornada ${round.id}`;
  return `<section class="hero"><div class="hero-content">
    <div class="hero-meta"><span class="eyebrow">${openForPlayer ? `Jornada ${round.id}` : "Reto común"}</span>${roundStatus(round)}</div>
    <h1>${title}</h1><p>${h(round.challenge)}</p>
    ${openForPlayer ? `<a class="button accent" href="#alineacion" data-route data-round="${round.id}">Mi alineación</a>` :
      `<a class="button accent" href="#${isAdmin() ? "gestion" : "jornadas"}" data-route>${isAdmin() ? "Gestionar jornada" : "Ver jornadas"}</a>`}
  </div></section>
  <section class="stat-grid" aria-label="Datos de la liga">
    ${isAdmin() ? stat("Scouters inscritos", state.players.length) + stat("Secciones", state.sections.length) +
      stat("Jornadas cerradas", `${state.rounds.filter(({ status }) => status === "closed").length}/${state.rounds.length}`) :
      stat("Tu puesto", hasResults(own) ? own.rank : "—") + stat("Puntos fantasy", own?.total ?? 0) + stat("Puntos propios", own?.own ?? 0)}
  </section>
  <div class="home-grid">
    <section class="card"><div class="card-head"><h2>Clasificación</h2><a href="#clasificacion" data-route class="link-button">Ver tabla</a></div>${topFive()}</section>
    <section class="card"><div class="card-head"><h2>${isAdmin() ? "Secciones" : "Tu alineación"}</h2>
      ${isAdmin() ? "" : `<span class="hint">Jornada ${round.id}</span>`}</div>
      ${isAdmin() ? `<ul class="rule-list">${state.sections.map(({ id, name }) => `<li><strong>${h(name)}</strong><span class="pill">${state.players.filter(({ sectionId }) => sectionId === id).length} inscritos</span></li>`).join("")}</ul>` : lineupSummary(round)}
    </section>
  </div>`;
}

function pageHead(title, description, action = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p class="muted">${description}</p></div>${action}</div>`;
}

function roundSelect(id, value) {
  return `<div class="field"><label for="${id}">Jornada</label>
    <select id="${id}" data-select="${id}">${state.rounds.map((round) =>
      `<option value="${round.id}"${choose(round.id, value)}>Jornada ${round.id} · ${labels[round.status]}</option>`).join("")}</select>
  </div>`;
}

function pickOptions(current) {
  return '<option value="">Elige un scouter</option>' + state.sections.map((section) => {
    const candidates = state.players.filter((person) => person.sectionId === section.id && person.id !== me().id);
    if (!candidates.length) return "";
    return `<optgroup label="${h(section.name)}">${candidates.map(({ id, alias }) =>
      `<option value="${id}"${choose(id, current)}>${h(alias)}</option>`).join("")}</optgroup>`;
  }).join("");
}

function lineupPage() {
  const round = roundFor(lineupRound);
  const lineup = myLineup(round.id);
  const result = myStanding()?.results.find(({ roundId }) => roundId === round.id);
  const available = state.players.length >= 3 && state.players.some(({ sectionId }) => sectionId !== me().sectionId);
  return `${pageHead("Alineación", `Tu equipo ${h(me().team)}`, refreshButton)}
    <div class="manage-grid">
      <section class="card">
        ${roundSelect("lineup-round", round.id)}
        <div class="round-meta">${roundStatus(round)}${roundDate(round)}</div>
        ${round.status === "open" ? `<form class="form pick-form" data-form="lineup" data-id="${round.id}">
          <p class="hint">Tú ocupas el primer puesto. Elige dos scouters y ficha al menos a uno de otra sección.</p>
          <div class="form-columns">
            <div class="field"><label for="first-pick">Fichaje 1</label><select id="first-pick" name="firstPickId" required>${pickOptions(lineup?.firstPickId)}</select></div>
            <div class="field"><label for="second-pick">Fichaje 2</label><select id="second-pick" name="secondPickId" required>${pickOptions(lineup?.secondPickId)}</select></div>
          </div>
          ${available ? "" : '<p class="hint">La alineación estará disponible cuando haya dos compañeros inscritos, con al menos uno de otra sección.</p>'}
          ${errorRegion}<button class="button primary" type="submit"${available ? "" : " disabled"}>Guardar alineación</button>
        </form>` : '<p class="hint">Podrás editar la alineación durante el plazo de fichajes.</p>'}
      </section>
      <section class="card"><h2>Alineación guardada</h2>${lineupSummary(round)}
        ${result?.scored ? `<p class="hint">${result.own} propios + ${result.picks} de fichajes = <strong>${result.total} pt</strong></p>` : ""}
      </section>
    </div>`;
}

function standingsPage() {
  return `${pageHead("Clasificación", "En empate, cuentan los puntos propios. Los equipos que sigan igualados comparten puesto.", refreshButton)}
    <section class="card table-card">${state.standings.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla de clasificación">
      <table><thead><tr><th scope="col">Puesto</th><th scope="col">Equipo</th><th scope="col">Sección</th>
        ${state.rounds.map(({ id }) => `<th scope="col" class="num" aria-label="Jornada ${id}">J${id}</th>`).join("")}
        <th scope="col" class="num">Propios</th><th scope="col" class="num">Total</th>
      </tr></thead><tbody>${state.standings.map((row) => `<tr${row.id === me()?.id ? ' class="active-row"' : ""}>
        <td class="rank">${hasResults(row) ? row.rank : "—"}</td>
        <th scope="row">${personLine(row.team, row.alias)}</th><td>${h(sectionName(row.sectionId))}</td>
        ${row.results.map((result) => `<td class="num">${result.scored ? result.total : "—"}</td>`).join("")}
        <td class="num">${row.own}</td><td class="num points">${row.total}</td>
      </tr>`).join("")}</tbody></table>
    </div>` : '<p class="empty">Los equipos aparecerán cuando se inscriban los scouters.</p>'}</section>`;
}

function roundsPage() {
  return `${pageHead("Jornadas", "Consulta el reto de cada jornada y el estado de los fichajes.")}
    <div class="round-grid">${state.rounds.map((round) => `<article class="card round-card">
      <div class="card-head"><h2>Jornada ${round.id}</h2>${roundStatus(round)}</div>
      ${roundDate(round)}<p>${h(round.challenge)}</p>
      ${isAdmin() ? "" : `<a href="#alineacion" data-route data-round="${round.id}" class="button secondary">${round.status === "open" ? "Elegir fichajes" : "Ver alineación"}</a>`}
    </article>`).join("")}</div>
    <section class="card">
      <div class="card-head"><h2>Cómo se puntúa</h2></div>
      <div class="rules-grid"><ul class="rule-list">${state.contributions.map(({ label, description, points }) =>
        `<li><strong>${label}</strong><small>${description}</small><span class="pill open">+${points}</span></li>`).join("")}</ul>
      <div><p>Cada aportación cuenta en una sola categoría. Puedes sumar cada categoría una vez por jornada.</p>
        <p>El equipo suma tus puntos propios y los puntos propios de tus fichajes. La preparación entre semana también cuenta.</p></div></div>
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
        <div class="field"><label for="round-date">Fecha de la jornada</label><input id="round-date" name="date" type="date" value="${h(round.date)}"></div>
        <div class="field"><label for="round-challenge">Reto común</label><textarea id="round-challenge" name="challenge" maxlength="280" required>${h(round.challenge)}</textarea></div>
        ${errorRegion}<button class="button secondary" type="submit">Guardar calendario</button>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h2>Fase de la jornada</h2>${roundStatus(round)}</div>
      <p class="muted">${next.hint}</p>
      <form class="form" data-form="phase" data-id="${round.id}" data-action="${next.action}">
        ${errorRegion}<button class="button primary" type="submit">${next.label}</button>
      </form>
    </section>
  </div>`;
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
    return `<section class="card">
      <div class="card-head"><h2>${h(section.name)}</h2><span class="pill">${members.length} inscritos</span></div>
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

function manageScores() {
  const sections = state.sections.filter(({ id }) => state.viewer.reviewIds.includes(id));
  const round = roundFor(reviewRound ?? state.rounds.find(({ status }) => status === "scoring")?.id);
  const members = state.players.filter(({ sectionId }) =>
    state.viewer.reviewIds.includes(sectionId) && (!reviewSection || reviewSection === sectionId));
  const target = members.find(({ id }) => id === reviewPlayer) ?? members[0];
  const scores = new Map(state.reviewScores.filter(({ roundId }) => roundId === round.id).map((score) => [score.playerId, score]));
  const saved = target ? scores.get(target.id) : null;
  const enabled = round.status === "scoring";
  const number = members.filter(({ id }) => scores.has(id)).length;
  const total = state.contributions.reduce((points, { points: value }, index) =>
    points + (saved?.mask & (1 << index) ? value : 0), 0);

  return `<div class="manage-grid">
    <section class="card">
      <div class="card-head"><h2>Jornada y sección</h2>${roundStatus(round)}</div>
      ${roundSelect("review-round", round.id)}
      <div class="field"><label for="review-section">Sección</label><select id="review-section" data-select="review-section">
        <option value="0">Todas mis secciones</option>
        ${sections.map(({ id, name }) => `<option value="${id}"${choose(id, reviewSection)}>${h(name)}</option>`).join("")}
      </select></div>
      <div class="field"><label for="review-player">Scouter</label><select id="review-player" data-select="review-player"${target ? "" : " disabled"}>
        ${members.length ? members.map(({ id, alias }) => `<option value="${id}"${choose(id, target.id)}>${h(alias)}${scores.has(id) ? " · registrado" : ""}</option>`).join("") : '<option>Sin scouters inscritos</option>'}
      </select></div>
      <p class="hint">${number} de ${members.length} puntuaciones registradas.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Aportaciones ${target ? `de ${h(target.alias)}` : ""}</h2>${target ? `<span class="pill open" data-points>${total} pt</span>` : ""}</div>
      ${target ? `<form class="form" data-form="score" data-id="${round.id}" data-player="${target.id}">
        ${enabled ? "" : '<p class="hint">La organización puede abrir la fase de puntuación desde Jornadas.</p>'}
        <ul class="checklist">${state.contributions.map(({ id, label, description, points }, index) => `<li><label class="check-row">
          <input type="checkbox" name="category" value="${id}" data-value="${points}"${saved?.mask & (1 << index) ? " checked" : ""}${enabled ? "" : " disabled"}>
          <span><strong>${label}</strong><small>${description}</small></span><span class="points">+${points}</span>
        </label></li>`).join("")}</ul>
        <div class="field"><label for="score-note">Nota de aportaciones</label><textarea id="score-note" name="note" maxlength="280" placeholder="Opcional"${enabled ? "" : " disabled"}>${h(saved?.note)}</textarea></div>
        ${errorRegion}<button class="button primary" type="submit"${enabled ? "" : " disabled"}>Guardar puntuación</button>
      </form>` : '<p class="empty">Selecciona un scouter inscrito para registrar sus puntos.</p>'}
    </section>
  </div>`;
}

function managementPage() {
  const tabs = [["rounds", "Jornadas"], ["scores", "Puntuaciones"], ["sections", "Secciones"]];
  const panel = isAdmin() ? manageTab : "scores";
  return `${pageHead("Gestión", isAdmin() ? "Configura la liga y valida las aportaciones de cada jornada." : "Registra las aportaciones de tu sección.")}
    ${isAdmin() ? `<div class="segmented" aria-label="Panel de gestión">${tabs.map(([key, label]) =>
      `<button type="button" data-manage="${key}" aria-pressed="${panel === key}">${label}</button>`).join("")}</div>` : ""}
    ${panel === "rounds" ? manageRounds() : panel === "sections" ? manageSections() : manageScores()}`;
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
  app.innerHTML = `${topBar()}<main class="workspace" id="main" tabindex="-1">${pages[currentRoute]()}</main>
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
  lineupRound = setupRound = reviewRound = reviewPlayer = undefined;
  reviewSection = 0;
  history.replaceState(null, "", "#inicio");
}

const actions = {
  login: ({ alias, password }) => ["/api/login", "POST", { alias, password }],
  "admin-login": ({ password }) => ["/api/login", "POST", { role: "admin", password }],
  register: (values) => ["/api/register", "POST", { ...values, sectionId: Number(values.sectionId) }, "Equipo inscrito."],
  lineup: ({ firstPickId, secondPickId }, form) => [`/api/rounds/${form.dataset.id}/lineup`, "PUT",
    { firstPickId: Number(firstPickId), secondPickId: Number(secondPickId) }, "Alineación guardada."],
  round: (values, form) => [`/api/admin/rounds/${form.dataset.id}`, "PATCH", values, "Calendario guardado."],
  phase: (_, form) => [`/api/admin/rounds/${form.dataset.id}`, "PATCH", { action: form.dataset.action }, "Fase actualizada."],
  "add-section": (values) => ["/api/admin/sections", "POST", values, "Sección añadida."],
  "edit-section": ({ name, reviewerId }, form) => [`/api/admin/sections/${form.dataset.id}`, "PATCH",
    { name, reviewerId: reviewerId ? Number(reviewerId) : null }, "Sección guardada."],
  score: ({ note }, form, data) => [`/api/rounds/${form.dataset.id}/scores/${form.dataset.player}`, "PUT",
    { categories: data.getAll("category"), note }, "Puntuación guardada."],
};

app.addEventListener("submit", async (event) => {
  const form = event.target;
  const action = actions[form.dataset.form];
  if (!action) return;
  event.preventDefault();
  if (saving) return;
  const data = new FormData(form);
  const errorBox = form.querySelector("[data-error]");
  const button = form.querySelector('button[type="submit"]');
  saving = button.disabled = true;
  errorBox.hidden = true;
  try {
    const [path, method, body, message] = action(Object.fromEntries(data), form, data);
    await request(path, method, body);
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

app.addEventListener("change", (event) => {
  const control = event.target;
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
    case "review-section": reviewSection = value; reviewPlayer = undefined; break;
    case "review-player": reviewPlayer = value; break;
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
