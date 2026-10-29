// app.js — authentification, onboarding manager/équipe, coque du jeu
const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $app = document.getElementById('app');

const NATS = { FR:'France', BE:'Belgique', IT:'Italie', ES:'Espagne', DE:'Allemagne', NL:'Pays-Bas', DK:'Danemark', GB:'Royaume-Uni',
  CH:'Suisse', PT:'Portugal', NO:'Norvège', SE:'Suède', AT:'Autriche', US:'États-Unis', CA:'Canada', MX:'Mexique', CN:'Chine',
  JP:'Japon', TW:'Taïwan', KR:'Corée du Sud', IN:'Inde', QA:'Qatar', AU:'Australie', NZ:'Nouvelle-Zélande' };
const state = { user: null, manager: null, team: null, isAdmin: false, tab: 'dashboard' };

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// Noms des pays : la table « countries » est la référence unique (codes ISO + noms français), chargée à la connexion
async function loadCountries() { const { data } = await sb.from('countries').select('code, name_fr'); (data || []).forEach((c) => (NATS[c.code] = c.name_fr)); }
const natOptions = (sel = 'FR') => Object.entries(NATS).sort((a, b) => a[1].localeCompare(b[1], 'fr')).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
const fmtEUR = (n) => Number(n).toLocaleString('fr-FR') + ' €';

function logoSrc(team) {            // logo par défaut : pastille avec l'initiale
  if (team?.logo_url) return team.logo_url;
  const l = esc((team?.name || '?')[0].toUpperCase());
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='#10b981'/><text x='32' y='43' font-size='34' text-anchor='middle' fill='#052e16' font-family='Arial' font-weight='700'>${l}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function avatarSrc(m) {              // avatar par défaut : initiales
  if (m?.photo_url) return m.photo_url;
  const i = esc(((m?.first_name || '?')[0] + (m?.last_name || '')[0]).toUpperCase());
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='32' fill='#334155'/><text x='32' y='41' font-size='26' text-anchor='middle' fill='#e2e8f0' font-family='Arial' font-weight='700'>${i}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Gère le bouton + message d'erreur d'un formulaire
async function withBusy(btn, errEl, fn) {
  btn.disabled = true; errEl.textContent = '';
  try { await fn(); } catch (e) { errEl.textContent = e.message || String(e); }
  btn.disabled = false;
}

// ---------- Routage selon l'état du joueur ----------
async function route() {
  if (!state.user) return viewAuth();
  if (!window.natsLoaded) { await loadCountries(); window.natsLoaded = true; }
  const { data: m } = await sb.from('managers').select('*').eq('user_id', state.user.id).maybeSingle();
  state.manager = m;
  if (!m) return viewManager();
  const { data: t } = await sb.from('teams').select('*').eq('manager_id', m.id).maybeSingle();
  state.team = t;
  if (!t) return viewTeam();
  const { data: dv } = await sb.from('teams').select('*').eq('parent_team_id', t.id).maybeSingle();
  state.devTeam = dv;
  const { data: p } = await sb.from('profiles').select('is_admin').eq('user_id', state.user.id).maybeSingle();
  state.isAdmin = !!p?.is_admin;
  await loadGame();
  await loadStaffImpactCtx(state.team.id);
  viewGame();
}

// ---------- Écran 1 : connexion / inscription ----------
function viewAuth(mode = 'in') {
  $app.innerHTML = `
    <div class="card narrow">
      <h1>Cycling Manager</h1>
      <div><label>Email</label><input id="email" type="email" autocomplete="email"></div>
      <div><label>Mot de passe (6 caractères min.)</label><input id="pwd" type="password" autocomplete="current-password"></div>
      <div class="err" id="err"></div>
      <button id="go">${mode === 'in' ? 'Se connecter' : 'Créer le compte'}</button>
      <button class="link" id="swap">${mode === 'in' ? "Pas de compte ? S'inscrire" : 'Déjà un compte ? Connexion'}</button>
    </div>`;
  $('swap').onclick = () => viewAuth(mode === 'in' ? 'up' : 'in');
  $('go').onclick = () => withBusy($('go'), $('err'), async () => {
    const creds = { email: $('email').value.trim(), password: $('pwd').value };
    const { data, error } = mode === 'in' ? await sb.auth.signInWithPassword(creds) : await sb.auth.signUp(creds);
    if (error) throw error;
    if (!data.session) throw new Error('Compte créé : confirmez votre email puis connectez-vous.');
    // la suite est déclenchée par onAuthStateChange
  });
}

// ---------- Écran 2 : création du manager ----------
function viewManager() {
  $app.innerHTML = `
    <div class="card narrow">
      <h1>Votre profil de manager</h1>
      <div class="row2">
        <div><label>Prénom</label><input id="fn"></div>
        <div><label>Nom</label><input id="ln"></div>
      </div>
      <div class="row2">
        <div><label>Âge (25-80)</label><input id="age" type="number" min="25" max="80" value="40"></div>
        <div><label>Nationalité</label><select id="nat">${natOptions()}</select></div>
      </div>
      <div><label>Photo de manager</label><div id="photos" class="muted">Chargement des photos…</div></div>
      <p class="muted">Réputation, pédagogie et négociation sont tirées au hasard (40-60) et évolueront avec vos résultats.</p>
      <div class="err" id="err"></div>
      <button id="go">Continuer</button>
      <button class="link" id="out">Se déconnecter</button>
    </div>`;
  $('out').onclick = () => sb.auth.signOut();

  let photoUrl = null, hasPhotos = false;
  sb.storage.from('manager-photos').list('', { limit: 100 }).then(({ data }) => {
    const files = (data || []).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    const box = $('photos');
    if (!files.length) { box.textContent = "Aucune photo disponible pour l'instant (un avatar par défaut sera utilisé)."; return; }
    hasPhotos = true; box.className = 'photos';
    box.innerHTML = files.map((f) => {
      const url = sb.storage.from('manager-photos').getPublicUrl(f.name).data.publicUrl;
      return `<img src="${esc(url)}" data-url="${esc(url)}" alt="">`;
    }).join('');
    box.querySelectorAll('img').forEach((img) => (img.onclick = () => {
      box.querySelectorAll('img').forEach((i) => i.classList.remove('sel'));
      img.classList.add('sel'); photoUrl = img.dataset.url;
    }));
  });

  $('go').onclick = () => withBusy($('go'), $('err'), async () => {
    const first_name = $('fn').value.trim(), last_name = $('ln').value.trim(), age = +$('age').value;
    if (!first_name || !last_name) throw new Error('Prénom et nom obligatoires.');
    if (age < 25 || age > 80) throw new Error("L'âge doit être compris entre 25 et 80 ans.");
    if (hasPhotos && !photoUrl) throw new Error('Choisissez une photo de manager.');
    const { error } = await sb.from('managers').insert({
      user_id: state.user.id, first_name, last_name, age, nationality: $('nat').value, photo_url: photoUrl,
      reputation: rnd(40, 60), pedagogy: rnd(40, 60), negotiation: rnd(40, 60),
    });
    if (error) throw error;
    await route();
  });
}

// ---------- Écran 3 : création de l'équipe (Conti-Pro imposée) ----------
function viewTeamLegacy() {
  $app.innerHTML = `
    <div class="card narrow">
      <h1>Votre équipe</h1>
      <div><label>Nom de l'équipe</label><input id="tn"></div>
      <div><label>Nationalité (influence les sponsors proposés)</label><select id="tnat">${natOptions(state.manager.nationality)}</select></div>
      <div><label>Logo PNG (optionnel, 1 Mo max)</label><input id="logo" type="file" accept="image/png"></div>
      <p class="muted">Division de départ : <b>Continental Pro</b> · Budget : <b>50 000 €</b> (trésorerie de départ : les sponsors financent la saison)</p>
      <div class="err" id="err"></div>
      <button id="go">Lancer ma carrière</button>
    </div>`;
  $('go').onclick = () => withBusy($('go'), $('err'), async () => {
    const name = $('tn').value.trim();
    if (!name) throw new Error("Donnez un nom à l'équipe.");
    let logoUrl = null;
    const file = $('logo').files[0];
    if (file) {
      if (file.type !== 'image/png') throw new Error('Le logo doit être un fichier PNG.');
      if (file.size > 1024 * 1024) throw new Error('Logo trop lourd (1 Mo max).');
      const path = `${state.user.id}.png`;
      const { error: eu } = await sb.storage.from('team-logos').upload(path, file, { upsert: true, contentType: 'image/png' });
      if (eu) throw eu;
      logoUrl = sb.storage.from('team-logos').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
    }
    const { error } = await sb.rpc('create_team', { p_name: name, p_nationality: $('tnat').value, p_logo_url: logoUrl });
    if (error) throw error;
    await route();
  });
}

// ---------- Écran 3 : choix d'une équipe officielle ----------
async function viewTeam() {
  $app.innerHTML = '<div class="card narrow"><p class="muted">Chargement des équipes…</p></div>';
  const [tm, rd] = await Promise.all([
    sb.from('teams').select('*').is('manager_id', null).order('name'),
    sb.from('riders').select('*').not('team_id', 'is', null),
  ]);
  const lvl = (r) => {
    let a = [r.mtn, r.mm, r.hil, r.ttr, r.fla, r.cob, r.spr, r.acc].filter((x) => x != null);
    if (!a.length) a = [r.flat, r.mountain, r.hills, r.time_trial, r.sprint, r.cobbles].filter((x) => x != null);
    return a.sort((x, y) => y - x).slice(0, 3).reduce((s, x) => s + x, 0) / 3;
  };
  const by = {}; (rd.data || []).forEach((r) => (by[r.team_id] = by[r.team_id] || []).push(r));
  const all = tm.data || [], devs = all.filter((t) => t.category === 'DEV' || t.parent_team_id), teams = all.filter((t) => !devs.includes(t));
  $app.innerHTML = `<div class="pickwrap"><h1>Choisissez votre équipe</h1>
    <p class="muted">Vous dirigez l'équipe pro et son éventuelle équipe de développement. Budget de départ : 50 000 € : il faudra signer des sponsors.</p><div class="err" id="err"></div>
    <div class="grid2">${teams.map((t) => {
      const dv = devs.find((d) => d.parent_team_id === t.id), rs = by[t.id] || [], rd2 = dv ? by[dv.id] || [] : [];
      const pay = rs.concat(rd2).reduce((s, r) => s + Number(r.contract_salary || 0), 0), star = rs.slice().sort((a, b) => lvl(b) - lvl(a))[0];
      return `<div class="card offer"><div class="head"><span style="display:flex;gap:.6rem;align-items:center"><img class="tlogo" src="${esc(logoSrc(t))}" alt=""><b>${esc(t.name)}</b></span><span class="badge warn">WorldTour</span></div>
        <ul class="kv"><li>Équipe pro : ${rs.length} coureurs</li><li>${dv ? `Équipe de développement : ${rd2.length} coureurs (${esc(dv.name)})` : 'Pas d\'équipe de développement'}</li>
        <li>Masse salariale : ${fmtEUR(pay)} / mois</li><li>Star : ${star ? esc(star.first_name + ' ' + star.last_name) : '-'}</li></ul>
        <button data-team="${t.id}">Choisir cette équipe</button></div>`;
    }).join('') || '<div class="card muted">Aucune équipe officielle disponible : les coureurs ne sont pas encore importés.<br><br><button id="legacy">Créer une équipe libre (mode test)</button></div>'}</div>
    <p><button class="link" id="out">Se déconnecter</button></p></div>`;
  $app.querySelectorAll('[data-team]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.rpc('claim_team', { p_team: b.dataset.team });
    if (error) { $('err').textContent = error.message; b.disabled = false; return; }
    await route();
  }));
  if ($('legacy')) $('legacy').onclick = viewTeamLegacy;
  $('out').onclick = () => sb.auth.signOut();
}

// ---------- Écran 4 : jeu (disposition type Football Manager) ----------
Object.assign(state, { menu: 'portal', tab: 'overview', hist: [['portal', 'overview']], hpos: 0, game: null, nextRace: null, mfilter: 'all', q: '', devTeam: null });
const myTeamIds = () => [state.team?.id, state.devTeam?.id].filter(Boolean);
const PROFILES = { FLAT: 'Plat', MOUNTAIN: 'Montagne', HILLS: 'Vallonné', COBBLES: 'Pavés', TIME_TRIAL: 'Contre-la-montre' };
const DAYS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const MENUS = {
  portal: { label: 'PORTAIL', subs: [['overview', "Vue d'ensemble"], ['messages', 'Messages'], ['calendar', 'Calendrier'], ['info', 'Infos'], ['data', 'Centre des données'], ['competitions', 'Compétitions'], ['career', 'Carrière']] },
  squad: { label: 'EFFECTIF', subs: [['squad', "Vue d'ensemble"], ['squad_pro', 'Équipe Pro'], ['squad_u23', 'Équipe Développement (U23)'], ['group', 'Dynamique de groupe'], ['health', 'Santé & Blessures'], ['trainrep', "Rapports d'entraînement"]] },
  recruit: { label: 'RECRUTEMENT', subs: [['overview', "Vue d'ensemble"], ['search', 'Base de données cyclistes'], ['recs', 'Recommandations'], ['missions', 'Recherches ciblées'], ['market', 'Marché des transferts & accords'], ['watch', 'Liste de sélection']] },  training: { label: 'ENTRAÎNEMENT', subs: [['overview', "Vue d'ensemble"], ['individual', 'Entraînement individuel'], ['intensity', 'Intensité & Repos'], ['assignments', 'Affectation du staff']] },
  finance: { label: 'SPONSORS & FINANCES', subs: [['contracts', 'Sponsors & Finances']] },
  club: { label: 'CLUB', subs: [['overview', "Vue d'ensemble"], ['infra', 'Infrastructures'], ['staff_overview', 'Staff'], ['staff_db', 'Base de données staff'], ['ranking', 'Classement UCI']] },};
const gd = (iso) => new Date(iso + 'T12:00:00');
const fmtShort = (iso) => { const d = gd(iso); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; };
const store = {
  get(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const toast = (msg) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); };
const daysUntil = (iso) => Math.round((gd(iso) - gd(state.game.game_date)) / 864e5);

async function loadGame() {
  const [g, r] = await Promise.all([
    sb.from('game_state').select('*').eq('id', 1).single(),
    sb.from('races').select('*').eq('status', 'SCHEDULED').order('date').limit(1),
  ]);
  state.game = g.data; state.nextRace = r.data?.[0] || null;
}

function go(menu, tab, push = true) {
  if (push) { state.hist = state.hist.slice(0, state.hpos + 1); state.hist.push([menu, tab]); state.hpos = state.hist.length - 1; }
  state.menu = menu; state.tab = tab; viewGame();
}
const step = (d) => { const n = state.hpos + d; if (n >= 0 && n < state.hist.length) { state.hpos = n; go(...state.hist[n], false); } };

async function continueGame() {
  if (state.isAdmin) {
    const d = gd(state.game.game_date); d.setDate(d.getDate() + 1);
    const { error } = await sb.from('game_state').update({ game_date: d.toISOString().slice(0, 10) }).eq('id', 1);
    if (error) return toast(error.message);
    const o = await sb.rpc('advance_observations');
    const te = await applyTrainingEffects(1, state.game.game_date).catch((e) => ({ error: e.message }));
    toast((o.error ? 'Jour suivant (observations : ' + o.error.message + ')' : 'Jour suivant.') + (te?.error ? ' Entraînement : ' + te.error : te ? ` Entraînement : +${te.gains} pt(s) d'attributs, ${te.injuries} blessure(s).` : ''));
  } else toast("Seul l'administrateur fait avancer le temps : date synchronisée.");
  await loadGame(); viewGame();
}

function viewGame() {
  const t = state.team, g = state.game, d = gd(g.game_date);
  const subs = [...MENUS[state.menu].subs]; if (state.menu === 'club' && state.isAdmin) subs.push(['admin', 'Admin'], ['stageimp', 'Admin : étapes'], ['racemgr', 'Admin : courses & tags']);
  const quick = [['portal|messages', 'Messages'], ['squad|squad', 'Équipe première'], ['recruit|search', 'Base de données cyclistes'], ['recruit|market', 'Marché des transferts'], ['portal|competitions', 'Compétitions']];
  const nr = state.nextRace, n = nr ? daysUntil(nr.date) : null;
  $app.innerHTML = `
    <header class="fm-top">
      <div class="fm-row1">
        <button class="nav-arrow" id="back">&lt;</button><button class="nav-arrow" id="fwd">&gt;</button>
        <div class="fm-brand"><img src="${esc(logoSrc(t))}" alt=""><b>${esc(t.official_name || t.name)}</b></div>
        <nav class="fm-main">${Object.entries(MENUS).map(([k, v]) => `<button data-menu="${k}" class="${k === state.menu ? 'on' : ''}">${v.label}</button>`).join('')}</nav>
        <div class="fm-tools">
          <input id="gsearch" placeholder="Rechercher un coureur" value="${esc(state.q)}"><span class="dot ${navigator.onLine ? '' : 'off'}" title="Connexion"></span>
          <div class="fm-date"><b>${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}</b><span>${nr ? (n <= 0 ? 'Course aujourd\'hui' : `Prochaine course : ${n} jour${n > 1 ? 's' : ''}`) : 'Aucune course prévue'}</span></div>
          <button class="fm-continue" id="cont">Continuer &raquo;</button><button class="link" id="out">Quitter</button>
        </div>
      </div>
      <div class="fm-row2">
        <nav class="fm-sub">${subs.map(([k, l]) => `<button data-sub="${k}" class="${k === state.tab || (k === 'staff_overview' && state.tab.startsWith('staff_') && state.tab !== 'staff_db') ? 'on' : ''}">${l}</button>`).join('')}</nav>
        <nav class="fm-quick">${quick.map(([k, l]) => `<button data-go="${k}">${l}</button>`).join('')}</nav>
      </div>
    </header>
    <main id="content"></main>`;
  document.querySelectorAll('[data-menu]').forEach((b) => (b.onclick = () => go(b.dataset.menu, MENUS[b.dataset.menu].subs[0][0])));
  document.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => go(state.menu, b.dataset.sub)));
  document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(...b.dataset.go.split('|'))));
  $('back').onclick = () => step(-1); $('fwd').onclick = () => step(1);
  $('out').onclick = () => sb.auth.signOut(); $('cont').onclick = continueGame;
  $('gsearch').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) { state.q = e.target.value.trim(); dbf.name = state.q; go('recruit', 'search'); } };
  renderTab();
}

async function renderTab() {
  const c = $('content'), tab = state.tab;
  if (tab === 'competitions') return renderLiveRaceDashboard(c);
  if (tab === 'stageimp') return renderStageImport(c);
  if (tab === 'racemgr') return renderRaceManager(c);
  if (tab === 'rider') return renderRider(c);
  if (tab === 'messages') return renderMessagesView(c);
  if (tab === 'admin') return renderAdmin(c);
  if (tab === 'search' || tab === 'watch') return renderDatabase(c, tab);
  if (tab === 'recruiters') return renderRecruiters(c);
  if (tab === 'missions') return renderMissions(c);
  if (tab === 'staff_overview') return renderStaffOverview(c);
  if (tab === 'staff_detail') return renderStaffDetail(c);
  if (tab === 'staff_db') return renderStaffDatabase(c);
  if (tab.startsWith('staff_')) return renderStaffList(c, tab);
  if (tab === 'overview' && state.menu === 'training') return renderTrainingOverview(c);
  if (tab === 'individual') return renderIndividualTraining(c);
  if (tab === 'overview' && state.menu === 'club') return renderClubOverview(c);
  if (tab === 'overview' && state.menu === 'recruit') return renderRecruitOverview(c);   // 'overview' existe aussi dans PORTAIL
  if (tab === 'portal' || tab === 'overview') return renderPortal(c);
  if (tab === 'contracts') return renderSponsors(c);
  if (tab === 'ranking') {
    const { data } = await sb.from('teams').select('name, official_name, nationality, uci_points').order('uci_points', { ascending: false });
    c.innerHTML = `<div class="panel"><h4>Classement UCI par équipes</h4><table class="fm">${(data || []).map((x, i) =>
      `<tr><td>${i + 1}</td><td>${esc(x.official_name || x.name)} (${esc(x.nationality)})</td><td>${x.uci_points} pts</td></tr>`).join('')}</table></div>`;
    return;
  }
  if (['squad', 'squad_pro', 'squad_u23'].includes(tab)) return renderSquad(c, tab);
  if (tab === 'searchres') {
    const q = state.q.replace(/[^\p{L}\p{N} '-]/gu, '');
    const { data } = await sb.from('riders').select('id, first_name, last_name, age, nationality, teams(name)').or(`last_name.ilike.%${q}%,first_name.ilike.%${q}%`).limit(50);
    c.innerHTML = `<div class="panel"><h4>Résultats pour « ${esc(q)} »</h4><table class="fm">${(data || []).map((r) =>
      `<tr><td><a class="rl" data-rider="${r.id}">${esc(r.first_name)} ${esc(r.last_name)}</a></td><td>${r.age} ans</td><td>${esc(r.nationality)}</td><td>${esc(r.teams?.name || 'Libre')}</td></tr>`).join('') || '<tr><td class="muted">Aucun coureur trouvé.</td></tr>'}</table>
      <p class="muted">Les notes des coureurs adverses sont masquées sans scouting.</p></div>`;
    return;
  }
  const all = Object.values(MENUS).flatMap((m) => m.subs).concat([['admin', 'Admin']]);
  c.innerHTML = `<div class="panel"><h4>${esc(all.find((x) => x[0] === tab)?.[1] || tab)}</h4><p class="muted">Cet écran sera construit dans une prochaine étape.</p></div>`;
}

// Messages dérivés des données du jeu (non stockés) ; l'état « lu » est gardé dans le navigateur
function buildMessages(ctx) {
  const t = state.team, today = fmtShort(state.game.game_date), out = [];
  if (!ctx.mine.length) out.push({ id: 'spons-none', from: 'Direction financière', cat: 'Sponsors', title: 'Aucun sponsor signé', body: "Sans sponsor, l'équipe n'a aucun revenu. Ouvrez Club > Sponsors & Finances.", task: true });
  ctx.riders.filter((r) => r.fatigue > 60).forEach((r) => out.push({ id: 'fat-' + r.id, from: 'Physiologiste', cat: 'Entraînement', title: `Fatigue élevée : ${r.first_name} ${r.last_name} (${r.fatigue})`, body: 'Prévoyez du repos avant la prochaine course.', toRead: true }));
  ctx.races.filter((r) => r.status === 'SCHEDULED' && daysUntil(r.date) <= 14 && !ctx.entryByRace[r.id]).slice(0, 3).forEach((r) => out.push({ id: 'entry-' + r.id, from: 'Directeur sportif', cat: 'Compétition', title: `Composer l'équipe : ${r.name}`, body: `Course le ${fmtShort(r.date)}. Sans validation, la sélection sera automatique.`, task: true }));
  ctx.sums.forEach((s, i) => out.push({ id: 'sum-' + i + (s.races?.name || ''), from: 'Presse', cat: 'Résultat', title: `Résumé : ${s.races?.name || 'course'}`, body: s.summary_text, toRead: true }));
  out.push({ id: 'welcome', from: "Conseil d'administration", cat: 'Direction', title: `Bienvenue à la tête de ${t.official_name || t.name}`, body: 'Objectif de la saison : bâtir un budget solide grâce aux sponsors puis progresser au classement UCI.', toRead: true });
    (ctx.offers || []).forEach((o) => out.push({ id: 'offer-' + o.id, from: 'Directeur sportif', cat: 'Transfert', offer: o,
    title: o.status === 'OFFICIALIZED' ? `Transfert officialisé : ${o.name}` : `Accord final : ${o.name}`, task: o.status === 'CONTRACT_ACCEPTED',
    time: o.updated_at ? new Date(o.updated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
    body: `L'agent et le club sont d'accord. Indemnité ${fmtEUR(o.offer_amount)}, salaire ${fmtEUR(o.offered_monthly_salary)} / mois, ${o.contract_years || 1} an(s).`,
    action: o.status === 'CONTRACT_ACCEPTED' ? `<div style="margin-top:.5rem"><button data-officialize="${o.id}">Officialiser le transfert</button></div>` : '' }));
  return out.map((m) => ({ ...m, date: today }));
}

function messagesHTML(msgs) {
  const key = 'cm_read_' + state.user.id, read = new Set(store.get(key, [])), f = state.mfilter;
  const list = msgs.filter((m) => f === 'all' || (f === 'new' && !read.has(m.id)) || (f === 'task' && m.task) || (f === 'toread' && m.toRead && !read.has(m.id)));
  const tab = (k, l) => `<button data-mf="${k}" class="${f === k ? 'on' : ''}">${l}</button>`;
  return `<div class="tabs">${tab('all', 'Tous')}${tab('new', 'Nouv. (' + msgs.filter((m) => !read.has(m.id)).length + ')')}${tab('task', 'Tâches (' + msgs.filter((m) => m.task).length + ')')}${tab('toread', 'À lire')}</div>
    <div class="msgs">${list.map((m) => `<div class="msg ${read.has(m.id) ? 'read' : ''}" data-msg="${esc(m.id)}">
      <div class="from"><span>${esc(m.from)}</span><span class="tag">${esc(m.cat)}</span></div><div class="title">${esc(m.title)}</div>
      <div class="muted">${m.date}</div><div class="body">${esc(m.body)}${m.action || ''}</div></div>`).join('') || '<p class="muted">Aucun message.</p>'}</div>`;
}

async function renderPortal(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const t = state.team, g = state.game;
  const [riders, races, teams, sums, mine, free, staff, entries, scoutsRes] = await Promise.all([
    sb.from('riders').select('*').in('team_id', myTeamIds()),
    sb.from('races').select('*').order('date'),
    sb.from('teams').select('id, name, official_name, division, uci_points').order('uci_points', { ascending: false }),
    sb.from('race_summaries').select('summary_text, races(name, date)').order('id', { ascending: false }).limit(3),
    sb.from('team_sponsors').select('monthly_payout').eq('team_id', t.id),
    sb.from('riders').select('id', { count: 'exact', head: true }).is('team_id', null),
    sb.from('staff').select('monthly_salary').eq('team_id', t.id),
    sb.from('race_entries').select('race_id, status').eq('team_id', t.id),
    sb.from('scouts').select('monthly_salary').eq('team_id', t.id),
  ]);
  const ctx = { riders: riders.data || [], races: races.data || [], mine: mine.data || [], sums: sums.data || [], entryByRace: Object.fromEntries((entries.data || []).map((e) => [e.race_id, e.status])) };
    ctx.offers = typeof loadAcceptedOffers === 'function' ? await loadAcceptedOffers() : [];
  const sum = (a, k) => a.reduce((s, x) => s + Number(x[k] || 0), 0);
  const payroll = sum(ctx.riders, 'contract_salary') + sum(staff.data || [], 'monthly_salary') + sum(scoutsRes.data || [], 'monthly_salary'), income = sum(ctx.mine, 'monthly_payout'), net = income - payroll;
  const health = net >= 0 ? 100 : Math.max(0, Math.min(100, Math.round((Number(t.budget) / -net / 6) * 100)));
  const upcoming = ctx.races.filter((r) => r.status === 'SCHEDULED'), nr = upcoming[0];
  const msgs = buildMessages(ctx);

  // Classement avec flèches (comparaison avec la date de jeu précédente, mémorisée dans le navigateur)
  const rk = teams.data || [], now = Object.fromEntries(rk.map((x, i) => [x.id, i + 1])), sk = 'cm_rank_' + state.user.id;
  let snap = store.get(sk, {}); snap = snap.date === g.game_date ? { ...snap, ranks: now } : { date: g.game_date, prev: snap.ranks || {}, ranks: now }; store.set(sk, snap);
  const arrow = (id) => { const p = snap.prev?.[id]; return p == null || p === now[id] ? '<span class="muted">=</span>' : p > now[id] ? '<span class="up">▲</span>' : '<span class="down">▼</span>'; };

  // Stats cyclistes
  const best = (k) => ctx.riders.slice().sort((a, b) => b[k] - a[k])[0];
  const rowS = (label, r, v) => `<div class="stat-row"><div>${label}<small>${r ? esc(r.first_name + ' ' + r.last_name) : 'n/a'}</small></div><b>${r ? v : '-'}</b></div>`;
  const avgFat = ctx.riders.length ? Math.round(sum(ctx.riders, 'fatigue') / ctx.riders.length) : 0;

  // Actualités : dernier résumé de course, sinon message d'accueil
  const s0 = ctx.sums[0], lines = (s0?.summary_text || '').split('\n').map((x) => x.replace(/^[^\p{L}\p{N}]+/u, '')).filter(Boolean);
  const myRank = now[t.id];
  const plan = ['Foncier', 'Aéro', 'Sprint', 'Montagne', 'Récup.', 'Foncier', 'Repos'], today = (gd(g.game_date).getDay() + 6) % 7;

  c.innerHTML = `<div class="portal">
    <div><div class="panel"><h4>Messages</h4><div id="msgbox">${messagesHTML(msgs)}</div></div></div>
    <div>
      <div class="panel"><h4>Infos</h4>
        <div class="hero"><b>${esc(s0 ? lines[0] : `Saison ${g.season_year} : l'aventure commence`)}</b><p>${esc(s0 ? lines.slice(1, 3).join(' ') : "Signez vos sponsors, composez l'équipe et visez le haut du classement UCI.")}</p></div>
        <div class="newsitem"><div><b>Classement UCI</b><div class="muted">Votre équipe est ${myRank}e sur ${rk.length} avec ${t.uci_points} points.</div></div></div>
        <div class="newsitem"><div><b>État de forme</b><div class="muted">Fatigue moyenne de l'effectif : ${avgFat}/100.</div></div></div></div>
      <div class="panel"><h4>Programme des courses</h4><table class="fm"><tr><th>Date</th><th>Course</th><th>Profil</th><th>Statut</th></tr>${upcoming.slice(0, 7).map((r) =>
        `<tr><td>${fmtShort(r.date)}</td><td>${esc(r.name)}</td><td>${PROFILES[r.profile_type] || ''} ${r.distance_km || ''} km</td><td>${ctx.entryByRace[r.id] === 'VALIDATED' ? 'Équipe validée' : 'À composer'}</td></tr>`).join('') || '<tr><td class="muted">Aucune course prévue.</td></tr>'}</table></div>
    </div>
    <div>
      <div class="panel"><h4>Classement UCI par équipes</h4><table class="fm"><tr><th>#</th><th></th><th>Équipe</th><th>Div.</th><th>Pts</th></tr>${rk.slice(0, 20).map((x, i) =>
        `<tr class="${x.id === t.id ? 'me' : ''}"><td>${i + 1}</td><td>${arrow(x.id)}</td><td>${esc(x.official_name || x.name)}</td><td>${x.division === 'WORLD_TOUR' ? 'WT' : 'CP'}</td><td>${x.uci_points}</td></tr>`).join('')}</table></div>
      <div class="panel"><h4>Stats cyclistes</h4>${rowS('Meilleur sprinteur', best('sprint'), best('sprint')?.sprint)}${rowS('Meilleur grimpeur', best('mountain'), best('mountain')?.mountain)}${rowS('Coureur le plus régulier', best('stamina'), best('stamina')?.stamina)}
        <div class="stat-row"><div>Fatigue moyenne<small>Effectif de ${ctx.riders.length} coureurs</small></div><b>${avgFat}</b></div></div>
    </div>
    <div>
      <div class="panel"><h4>Prochaine épreuve</h4>${nr ? `<div class="big">${esc(nr.name)}</div><div class="muted">${fmtShort(nr.date)} · ${PROFILES[nr.profile_type] || ''} · ${nr.distance_km || '?'} km</div>` : '<p class="muted">Aucune course prévue.</p>'}</div>
      <div class="panel"><h4>Budget & finances</h4><div class="muted">Budget disponible</div><div class="big">${fmtEUR(t.budget)}</div>
        <div class="stat-row"><span>Masse salariale / mois</span><b>${fmtEUR(payroll)}</b></div><div class="stat-row"><span>Revenus sponsors / mois</span><b>${fmtEUR(income)}</b></div>
        <div class="muted" style="margin-top:.4rem">Santé financière</div><div class="meter"><i style="width:${health}%"></i></div></div>
      <div class="panel"><h4>Recherche de talents</h4><div class="big">${free.count ?? 0}</div><div class="muted">coureurs sans contrat sur le marché</div></div>
      <div class="panel"><h4>Entraînement</h4><div class="week">${['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'].map((d, i) => `<div class="${i === today ? 'today' : ''}"><b>${d}</b><br>${plan[i]}</div>`).join('')}</div><div class="muted" style="margin-top:.4rem">Plan par défaut</div></div>
    </div></div>`;

  const box = $('msgbox'), bind = () => {
    box.querySelectorAll('[data-mf]').forEach((b) => (b.onclick = () => { state.mfilter = b.dataset.mf; box.innerHTML = messagesHTML(msgs); bind(); }));
    box.querySelectorAll('[data-msg]').forEach((m) => (m.onclick = () => {
      const k = 'cm_read_' + state.user.id, r = new Set(store.get(k, [])); r.add(m.dataset.msg); store.set(k, [...r]);
      m.classList.add('read'); m.classList.toggle('open');
    }));
  };
  bind();
}

async function renderClubOverview(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const t = state.team, dv = state.devTeam, ids = myTeamIds();
  const [tm, sp, st, sc, rs, inf, off] = await Promise.all([
    sb.from('teams').select('id, name, official_name, uci_points').order('uci_points', { ascending: false }),
    sb.from('team_sponsors').select('*, sponsors_catalog(name)').eq('team_id', t.id),
    sb.from('staff').select('*').eq('team_id', t.id),
    sb.from('scouts').select('monthly_salary').eq('team_id', t.id),
    sb.from('riders').select('id, team_id, age, contract_salary').in('team_id', ids),
    sb.from('team_infrastructures').select('*').eq('team_id', t.id),
    sb.from('transfer_offers').select('*').or(`from_team_id.eq.${t.id},to_team_id.eq.${t.id}`).eq('status', 'OFFICIALIZED'),
  ]);
  const riders = rs.data || [], rid = riders.map((r) => r.id);
  const { data: wr } = rid.length ? await sb.from('race_results').select('rider_id').in('rider_id', rid).eq('position', 1) : { data: [] };
  const sum = (a, k) => (a || []).reduce((s, x) => s + Number(x[k] || 0), 0), kv = (l, v, cls = '') => `<div class="stat-row"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  const ranks = tm.data || [], rank = ranks.findIndex((x) => x.id === t.id) + 1, wt = t.division === 'WORLD_TOUR';
  const pro = riders.filter((r) => r.team_id === t.id), dev = riders.filter((r) => dv && r.team_id === dv.id), wins = (wr || []).length;
  const income = sum(sp.data, 'monthly_payout'), payroll = sum(riders, 'contract_salary'), staffCost = sum(st.data, 'monthly_salary') + sum(sc.data, 'monthly_salary'), maint = sum(inf.data, 'maintenance_cost');
  const expenses = payroll + staffCost + maint, balance = income - expenses, pct = income ? Math.min(100, Math.round((payroll / income) * 100)) : 100;
  const objectives = [
    { l: `Terminer dans le top ${Math.ceil(ranks.length / 2)} du classement UCI`, p: 'Nécessaire', ok: rank > 0 && rank <= Math.ceil(ranks.length / 2), h: `Position actuelle : ${rank}e / ${ranks.length}` },
    { l: wt ? 'Remporter 3 victoires WorldTour' : 'Remporter 3 victoires', p: 'Souhaitable', ok: wins >= 3, h: `${wins} / 3 victoires` },
    { l: 'Équilibrer le budget mensuel', p: 'Nécessaire', ok: balance >= 0, h: `Solde mensuel : ${fmtEUR(balance)}` },
    { l: 'Faire progresser 4 jeunes en équipe de développement', p: 'Préférable', ok: dev.length >= 4, h: `${dev.length} / 4 coureurs` },
  ], met = objectives.filter((o) => o.ok).length, sat = Math.round((met / objectives.length) * 100);
  const near = ranks.slice(Math.max(0, rank - 3), Math.max(0, rank - 3) + 5);
  const roleN = (r) => (st.data || []).filter((x) => x.role === r).length, sRows = [['Directeurs sportifs', 0, 2], ['Entraîneurs', roleN('COACH'), 3], ['Attachés de presse', roleN('PRESS'), 1], ['Pôle médical (nutrition, kinés)', roleN('NUTRITIONIST') + roleN('MASSEUR'), 3], ['Recruteurs', (sc.data || []).length, 4]];
  const INF = [['GYM', 'Centre de performance'], ['AERO_RD', 'Pôle R&D / matériel'], ['MEDICAL', 'Centre médical'], ['SCOUTING', 'Centre de scouting'], ['BUS', "Bus d'équipe"], ['VEHICLES', 'Flotte de véhicules']];
  const lvl = (k) => (inf.data || []).find((x) => x.type === k)?.level || 0;
  const arr = (off.data || []).filter((o) => o.from_team_id === t.id), dep = (off.data || []).filter((o) => o.to_team_id === t.id);
  c.innerHTML = `<div class="rov">
    <div class="panel"><h4>Site du club</h4><div style="display:flex;gap:.8rem;align-items:center"><img class="tlogo" src="${esc(logoSrc(t))}" alt=""><div><div class="big">${esc(t.official_name || t.name)}</div><div class="muted">${esc(NATS[t.nationality] || t.nationality)}</div></div></div>
      ${kv('Division', wt ? 'WorldTour' : 'Continental Pro')}${kv('Réputation du club', wt ? 'Mondiale' : 'Nationale')}${kv('Points UCI', t.uci_points)}${kv('Effectif', pro.length + ' coureurs')}<div style="display:flex;gap:.8rem;align-items:center;margin-top:.7rem">${avatarWithEdit(state.manager, 'manager')}<div><b>${esc(state.manager.first_name)} ${esc(state.manager.last_name)}</b><div class="muted">Manager</div></div></div>
      <div class="muted" style="margin-top:.5rem">Classement UCI</div>${near.map((x) => `<div class="stat-row ${x.id === t.id ? 'up' : ''}"><span>${ranks.indexOf(x) + 1}. ${esc(x.official_name || x.name)}</span><b>${x.uci_points} pts</b></div>`).join('')}</div>
    <div class="panel"><h4>Vision du club</h4><div class="muted">Objectifs du board (${objectives.length})</div>
      ${objectives.map((o) => `<div class="stat-row"><div>${o.l}<small>${o.h} · ${o.p}</small></div><span class="bd ${o.ok ? 'green' : 'amber'}">${o.ok ? 'Atteint' : 'En cours'}</span></div>`).join('')}</div>
    <div class="panel"><h4>Retours du board</h4><div class="big ${sat >= 50 ? 'up' : 'down'}">${sat >= 75 ? 'Très satisfait' : sat >= 50 ? 'Satisfait' : sat >= 25 ? 'Préoccupé' : 'Mécontent'}</div><div class="muted">${met} objectif(s) sur ${objectives.length} atteint(s)</div><div class="meter"><i style="width:${sat}%"></i></div>
      ${kv('Santé financière', balance >= 0 ? 'Saine' : 'Déficitaire', balance >= 0 ? 'up' : 'down')}${kv('Sponsors signés', (sp.data || []).length)}</div>
    <div class="panel"><h4>Finances</h4><div class="muted">Trésorerie globale</div><div class="big">${fmtEUR(state.team.budget)}</div>
      ${kv('Revenus sponsors / mois', fmtEUR(income))}${kv('Dépenses / mois', fmtEUR(expenses))}${kv('Solde mensuel', fmtEUR(balance), balance >= 0 ? 'up' : 'down')}
      <div class="muted" style="margin-top:.5rem">Masse salariale des coureurs : ${fmtEUR(payroll)} (${pct} % des revenus)</div><div class="meter"><i style="width:${pct}%"></i></div></div>
    <div class="panel"><h4>Staff</h4>${sRows.map(([l, n, max]) => `<div class="stat-row"><div>${l}<small>${n >= max ? 'Complet' : max - n + ' poste(s) vacant(s)'}</small></div><b>${n} / ${max}</b></div>`).join('')}
      ${kv('Coût du staff / mois', fmtEUR(staffCost))}<div class="rov-btns"><button data-cgo="club|staff_scouting">Staff de recrutement</button></div></div>
    <div class="panel"><h4>Sponsors</h4>${(sp.data || []).map((x) => `<div class="stat-row"><span>${esc(x.sponsors_catalog?.name || 'Sponsor')}</span><b>${fmtEUR(x.monthly_payout)} / mois</b></div>`).join('') || '<p class="muted">Aucun sponsor signé.</p>'}
      <div class="rov-btns"><button data-cgo="finance|contracts">Sponsors & Finances</button></div></div>
    <div class="panel"><h4>Infrastructures</h4>${INF.map(([k, l]) => `<div class="stat-row"><span>${l}</span><span class="bd ${lvl(k) ? 'green' : 'spec'}">${lvl(k) ? 'Niv. ' + lvl(k) + ' / 5' : 'Non construit'}</span></div>`).join('')}
      <div class="stat-row"><span>Centre de formation jeune</span><span class="bd ${dv ? 'green' : 'spec'}">${dv ? 'Équipe U23 liée' : 'Aucun'}</span></div></div>
    <div class="panel"><h4>Historique des transferts</h4>${kv('Arrivées', `${arr.length} · ${fmtEUR(sum(arr, 'offer_amount'))}`)}${kv('Départs', `${dep.length} · ${fmtEUR(sum(dep, 'offer_amount'))}`)}
      <div class="rov-btns"><button data-cgo="recruit|market">Marché des transferts</button></div></div>
    <div class="panel"><h4>Équipe de développement</h4>${dv ? `<div style="display:flex;gap:.8rem;align-items:center"><img class="tlogo" src="${esc(logoSrc(dv))}" alt=""><div class="big">${esc(dv.official_name || dv.name)}</div></div>
      ${kv('Coureurs', dev.length)}${kv('Âge moyen', dev.length ? (sum(dev, 'age') / dev.length).toFixed(1) + ' ans' : '-')}${kv('Masse salariale / mois', fmtEUR(sum(dev, 'contract_salary')))}
      <div class="rov-btns"><button data-cgo="squad|squad_u23">Voir l'équipe U23</button></div>` : '<p class="muted">Aucune équipe de développement liée à ce club.</p>'}</div>
  </div>`;
  c.onclick = (e) => { const b = e.target.closest('[data-cgo]'); if (b) go(...b.dataset.cgo.split('|')); };
}

const STAFF_TABS = [['staff_overview', "Vue d'ensemble"], ['staff_coaching', "Équipe d'encadrement"], ['staff_scouting', 'Équipe de recrutement'], ['staff_medical', 'Équipe médicale'], ['staff_all', 'Tout le staff']];
const STAFF_ALIAS = { COACH: 'DS', MASSEUR: 'PHYSIO' };
const STAFF_POLES = {   // quotas par division : [WorldTour, ProTeam, Continental]
  staff_coaching: { name: "Équipe d'encadrement", cap: [10, 7, 4], roles: [['HEAD_DS', 'Directeur sportif en chef', [1, 1, 1]], ['DS', 'Entraîneur / Directeur sportif', [4, 3, 1]], ['TRAINER', 'Préparateur physique', [3, 2, 1]], ['TACTICS', 'Responsable tactique / course', [2, 1, 1]]] },
  staff_scouting: { name: 'Équipe de recrutement', cap: [8, 5, 3], roles: [['RECRUIT_HEAD', 'Responsable du recrutement', [1, 1, 1]], ['SCOUT', 'Scout / Éclaireur', [5, 3, 1]], ['ANALYST', 'Analyste de données', [2, 1, 1]]] },
  staff_medical: { name: 'Équipe médicale et performance', cap: [10, 7, 4], roles: [['DOCTOR', "Médecin d'équipe", [2, 1, 1]], ['PHYSIO', 'Kinésithérapeute / Ostéopathe', [4, 3, 1]], ['NUTRITIONIST', 'Nutritionniste', [2, 1, 1]], ['MECHANIC', 'Mécanicien chef', [2, 2, 1]]] },
};
const STAFF_LABEL = { PRESS: 'Attaché de presse', ...Object.fromEntries(Object.values(STAFF_POLES).flatMap((p) => p.roles.map((r) => [r[0], r[1]]))) };
const staffDiv = () => (state.team.division === 'WORLD_TOUR' ? 0 : state.team.division === 'PRO_TEAM' ? 1 : 2);
const staffNavHTML = (tab) => `<div class="tabs staffnav">${STAFF_TABS.map(([k, l]) => `<button data-snav="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>`;

async function loadStaff() {
  const [st, sc] = await Promise.all([sb.from('staff').select('*').eq('team_id', state.team.id), sb.from('scouts').select('*').eq('team_id', state.team.id)]);
  return [
    ...(st.data || []).map((x) => ({ key: 'staff:' + x.id, name: x.name, role: STAFF_ALIAS[x.role] || x.role, nat: x.nationality, type: x.contract_type || 'Plein temps', salary: Number(x.monthly_salary || 0), end: x.contract_end_year })),
    ...(sc.data || []).map((x) => ({ key: 'scout:' + x.id, name: x.name, role: 'SCOUT', nat: x.country, type: 'Plein temps', salary: Number(x.monthly_salary || 0), end: null })),
  ];
}

function staffPoleCard(p, rows, compact) {
  const di = staffDiv(), cnt = {}, cost = {};
  rows.forEach((x) => { cnt[x.role] = (cnt[x.role] || 0) + 1; cost[x.role] = (cost[x.role] || 0) + x.salary; });
  const cap = p.cap[di], have = p.roles.reduce((s, [k, , q]) => s + Math.min(cnt[k] || 0, q[di]), 0), min = Math.ceil(cap * 0.7), pay = p.roles.reduce((s, [k]) => s + (cost[k] || 0), 0);
  const miss = p.roles.filter(([k, , q]) => (cnt[k] || 0) < q[di]).map(([k, l, q]) => `${l} (${cnt[k] || 0}/${q[di]})`).slice(0, 3).join(', ');
  const fb = have >= cap ? `Le pôle « ${p.name} » est complet : les dirigeants sont pleinement satisfaits.` : have >= min ? `Le pôle est bien pourvu (${have}/${cap}). À compléter : ${miss}.`
    : `Avec ${have} membre(s) sur ${cap} postes, le pôle est sous-effectif : les dirigeants attendent au moins ${min} membres. Priorité : ${miss}.`;
  return `<div class="panel"><h4>${p.name}</h4><div class="big">${have} / ${cap} <span class="muted" style="font-size:.8rem;font-weight:400">postes pourvus</span></div><div class="meter"><i style="width:${Math.round((have / cap) * 100)}%"></i></div>
    ${compact ? '' : p.roles.map(([k, l, q]) => { const n = cnt[k] || 0, m = q[di]; return `<div class="stat-row"><span><span class="bd ${n >= m ? 'green' : n === 0 ? 'red' : 'amber'}">${n}/${m}</span> ${l}</span><span class="mini"><i style="width:${Math.min(100, (n / m) * 100)}%"></i></span></div>`; }).join('')}
    <div class="stat-row"><span>Coût du pôle</span><b>${fmtEUR(pay)} / mois</b></div>
    <div class="muted" style="margin-top:.6rem"><b>Retour du comité directeur</b></div><p class="${have >= min ? '' : 'down'}" style="margin:.2rem 0 0;font-size:.85rem">${fb}</p></div>`;
}

function bindStaffNav(c) {
  c.onclick = (e) => {
    const n = e.target.closest('[data-snav]'), a = e.target.closest('[data-sact]'), r = e.target.closest('[data-srow]');
    if (n) return go('club', n.dataset.snav);
    if (a) {
      const [act, key] = a.dataset.sact.split('|');
      if (act === 'fire') return fireStaff(key);
      if (act === 'hire') return hireStaff(key);
      if (act === 'offer') return renderStaffContractModal(key);
      state.sid = key; return go('club', 'staff_detail');
    }
    if (r) { state.sid = r.dataset.srow; go('club', 'staff_detail'); }
  };
}
async function fireStaff(key) {
  if (!confirm('Licencier ce membre du staff ?')) return;
  const [src, id] = key.split(':');
  const { error } = src === 'scout' ? await sb.rpc('fire_scout', { p_scout: id }) : await sb.rpc('fire_staff', { p_staff: id });
  if (error) return toast(error.message);
  toast('Membre du staff licencié.'); state.tab === 'staff_detail' ? go('club', 'staff_all') : renderTab();
}

async function renderStaffOverview(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const all = await loadStaff();
  c.innerHTML = staffNavHTML('staff_overview') + `<div class="rov">${Object.values(STAFF_POLES).map((p) => staffPoleCard(p, all.filter((x) => p.roles.some((r) => r[0] === x.role)))).join('')}</div>`;
  bindStaffNav(c);
}

async function renderStaffList(c, tab) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const all = await loadStaff(), p = STAFF_POLES[tab], rows = (p ? all.filter((x) => p.roles.some((r) => r[0] === x.role)) : all).sort((a, b) => b.salary - a.salary);
  const head = p ? `<div class="rov"><div class="span3">${staffPoleCard(p, rows, true)}</div></div>`
    : `<div class="panel"><h4>Tout le staff</h4><div class="big">${rows.length} membres</div><div class="stat-row"><span>Coût total du staff</span><b>${fmtEUR(rows.reduce((s, x) => s + x.salary, 0))} / mois</b></div></div>`;
  const tr = (x) => `<tr data-srow="${x.key}" style="cursor:pointer"><td><span class="av">${esc(x.name.split(' ').map((s) => s[0]).slice(0, 2).join(''))}</span>${esc(x.name)}</td><td>${esc(STAFF_LABEL[x.role] || x.role)}</td>
    <td>${x.nat ? flag(x.nat) : '-'}</td><td>${esc(x.type)}</td><td>${fmtEUR(x.salary)} / mois</td><td>${x.end ? '31/12/' + x.end : '-'}</td>
    <td><button data-sact="open|${x.key}">Fiche</button> <button class="danger" data-sact="fire|${x.key}">Licencier</button></td></tr>`;
  c.innerHTML = staffNavHTML(tab) + head + `<div class="panel full" style="margin-top:.75rem"><div class="tbl"><table class="fm sq"><thead><tr><th>Nom</th><th>Fonction / Rôle</th><th>Nationalité</th><th>Type de contrat</th><th>Salaire mensuel</th><th>Fin de contrat</th><th>Actions</th></tr></thead>
    <tbody>${rows.map(tr).join('') || '<tr><td colspan="7" class="muted">Aucun membre du staff dans ce pôle.</td></tr>'}</tbody></table></div></div>`;
  bindStaffNav(c);
}

const STAFF_ATTR_KEYS = [['race', 'Stratégie de course'], ['prep', 'Préparation physique'], ['recov', 'Science de la récupération'], ['talent', 'Détection de jeunes'], ['care', 'Soins / Aigu'],
  ['adapt', 'Adaptabilité'], ['auth', 'Autorité'], ['motiv', 'Capacité à motiver'], ['stress', 'Gestion du stress'], ['nego', 'Négociation']];
const STAFF_BIAS = { HEAD_DS: { race: 10, auth: 10, motiv: 6, nego: 6 }, DS: { race: 8, auth: 5, stress: 4 }, TRAINER: { prep: 10, motiv: 4 }, TACTICS: { race: 12, adapt: 5 },
  RECRUIT_HEAD: { talent: 10, nego: 8 }, SCOUT: { talent: 12, adapt: 5 }, ANALYST: { talent: 6, race: 5 }, DOCTOR: { care: 12, recov: 6, stress: 5 }, PHYSIO: { recov: 10, care: 6 },
  NUTRITIONIST: { recov: 8, prep: 5 }, MECHANIC: { stress: 5, adapt: 4 }, PRESS: { nego: 8, stress: 6 } };
// Notes /100 : valeurs enregistrées (colonne attrs) sinon déduites de l'évaluation globale et du métier (stables d'une visite à l'autre)
function staffAttrs(x, role) {
  if (x.attrs && Object.keys(x.attrs).length) return x.attrs;
  return Object.fromEntries(STAFF_ATTR_KEYS.map(([k]) => [k, Math.max(30, Math.min(99, (x.rating ?? 60) + (STAFF_BIAS[role]?.[k] || -4) + ((hashN(x.id + k) % 11) - 5)))]));
}

async function renderStaffDetail(c, staffId = state.sid) {
  const [src, id] = String(staffId || '').split(':');
  const { data: x } = src ? await sb.from(src === 'scout' ? 'scouts' : 'staff').select('*').eq('id', id).maybeSingle() : { data: null };
  if (!x) { c.innerHTML = staffNavHTML('staff_all') + '<div class="panel">Membre du staff introuvable.</div>'; return bindStaffNav(c); }
  const sc = src === 'scout', role = sc ? 'SCOUT' : STAFF_ALIAS[x.role] || x.role, nat = sc ? x.country : x.nationality, key = `${src}:${x.id}`, own = x.team_id === state.team.id;
  const rating = sc ? Math.round(((x.judging_current_ability + x.judging_potential_ability + x.adaptability) / 3) * 5) : x.rating ?? 60, A = staffAttrs({ ...x, rating }, role);
  const { data: tm } = x.team_id ? await sb.from('teams').select('name, official_name, logo_url').eq('id', x.team_id).maybeSingle() : { data: null };
  const WANT = { HEAD_DS: ['HEAD_DS', 2], DS: ['DS', 2], TRAINER: ['TRAINER', 2], TACTICS: ['TACTICS', 2], RECRUIT_HEAD: ['RECRUIT_HEAD', 3], SCOUT: ['SCOUT', 2], ANALYST: ['ANALYST', 2], DOCTOR: ['DOCTOR', 3], PHYSIO: ['PHYSIO', 2], NUTRITIONIST: ['NUTRITIONIST', 2], MECHANIC: ['MECHANIC', 2] };
  const wantRole = sc ? 'SCOUT' : x.wanted_role || WANT[role]?.[0] || role, langs = (sc ? [] : x.languages || []).length ? x.languages : ['Anglais', ...(nat ? [({ FR: 'Français', IT: 'Italien', ES: 'Espagnol', DE: 'Allemand', NL: 'Néerlandais', BE: 'Français', PT: 'Portugais', DK: 'Danois' })[nat]].filter(Boolean) : [])];
  const rep = ['Locale', 'Nationale', 'Continentale', 'Internationale', 'Légende du peloton'][rating < 55 ? 0 : rating < 65 ? 1 : rating < 75 ? 2 : rating < 85 ? 3 : 4];
  const tone = (v) => (v >= 80 ? 'g4' : v >= 65 ? 'g3' : v >= 50 ? 'g2' : 'g1'), row = ([k, l]) => `<div class="arow"><span>${l}</span><span class="an ${tone(A[k])}">${A[k]}</span></div>`;
  const kv = (l, v) => `<div class="stat-row"><span>${l}</span><b>${v}</b></div>`;
  const career = [...(x.career || []).map((h) => `${h.year} : ${esc(h.role)} · ${esc(h.team)}`), ...(tm ? [`Actuellement : ${esc(STAFF_LABEL[role] || role)} · ${esc(tm.official_name || tm.name)}`] : [])];
  const initials = esc(x.name.split(' ').map((s) => s[0]).slice(0, 2).join(''));
  c.innerHTML = staffNavHTML('staff_all') + `<div class="rhead">${avatarWithEdit(x, sc ? 'scout' : 'staff')}
    <div class="rid"><div class="rname">${esc(x.name)}</div><div class="muted">${esc(STAFF_LABEL[role] || role)} · ${nat ? flag(nat) : ''}${x.age ? ' · ' + x.age + ' ans' : ''}</div>
      <div class="actmenu"><button type="button" class="actbtn" id="sabtn">Actions <span class="chev">&#9662;</span></button><div class="actlist" id="salist" hidden>
        <button type="button" class="actitem" data-sact="offer|${key}" ${own ? 'disabled' : ''}>Signer le contrat</button>
        <button type="button" class="actitem" data-sact="fire|${key}" ${own ? '' : 'disabled'}>Résilier le contrat</button><hr>
        <button type="button" class="actitem" data-snav="staff_all">Retour à la liste</button></div></div></div>
    <div class="rteam"><img src="${esc(logoSrc(tm || { name: '?' }))}" alt=""><div><b>${esc(tm ? tm.official_name || tm.name : 'Sans contrat')}</b><div class="muted">Équipe actuelle</div></div></div>
    <div class="rbox"><div class="muted">Contrat</div><b>${fmtEUR(x.monthly_salary || 0)} / mois</b><div class="muted">Fin : ${x.contract_end_year ? '31/12/' + x.contract_end_year : '-'}</div></div>
    <div class="rbox"><div class="muted">Réputation</div><b>${rep}</b></div></div>
    <div class="rcols"><div class="panel"><h4>Attributs techniques / métier</h4>${STAFF_ATTR_KEYS.slice(0, 5).map(row).join('')}</div>
      <div class="panel"><h4>Attributs mentaux</h4>${STAFF_ATTR_KEYS.slice(5).map(row).join('')}</div>
      <div class="panel"><h4>Infos</h4>${kv('Rôle préféré', esc(STAFF_LABEL[wantRole] || wantRole))}${kv('Langues parlées', esc([...new Set(langs)].join(', ')))}${kv('Durée souhaitée', (x.wanted_years || 2) + ' an(s)')}${kv('Réputation', rep)}${kv('Évaluation globale', rating + ' / 100')}${kv('Type de contrat', esc(x.contract_type || 'Plein temps'))}
        <div class="muted" style="margin:.6rem 0 .2rem">Historique de carrière</div>${career.map((l) => `<div class="stat-row"><span>${l}</span></div>`).join('') || '<p class="muted">Aucun historique enregistré.</p>'}</div></div>`;
  bindStaffNav(c);
  const base = c.onclick;
  c.onclick = (e) => {
    const ab = e.target.closest('#sabtn');
    if (ab) { e.stopPropagation(); $('salist').hidden = !$('salist').hidden; return; }
    if (e.target.closest('#salist [data-sact],#salist [data-snav]')) $('salist').hidden = true;
    base(e);
  };
  if (!window.actBound) {
    window.actBound = true;
    document.addEventListener('click', (e) => { if (!e.target.closest('.actmenu')) document.querySelectorAll('.actlist').forEach((l) => (l.hidden = true)); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.actlist').forEach((l) => (l.hidden = true)); });
  }
}

const STAFF_CLOSE = [['HEAD_DS', 'DS'], ['DS', 'HEAD_DS'], ['DS', 'TACTICS'], ['TACTICS', 'DS'], ['HEAD_DS', 'TACTICS'], ['TRAINER', 'PHYSIO'], ['PHYSIO', 'TRAINER'], ['DOCTOR', 'PHYSIO'], ['PHYSIO', 'DOCTOR'], ['NUTRITIONIST', 'DOCTOR'], ['NUTRITIONIST', 'PHYSIO'], ['ANALYST', 'RECRUIT_HEAD'], ['RECRUIT_HEAD', 'ANALYST']];
const staffRoleOk = (given, want) => given === want || STAFF_CLOSE.some(([a, b]) => a === given && b === want);

async function renderStaffContractModal(key) {
  const [src, id] = key.split(':'), tid = state.team.id;
  const { data: x } = await sb.from(src === 'scout' ? 'scouts' : 'staff').select('*').eq('id', id).maybeSingle();
  if (!x) return toast('Membre du staff introuvable.');
  const sc = src === 'scout', role = sc ? 'SCOUT' : STAFF_ALIAS[x.role] || x.role, wantRole = sc ? 'SCOUT' : x.wanted_role || role, wantYears = sc ? 1 : x.wanted_years || 2, salary = Number(x.monthly_salary || 0);
  const [a, b] = await Promise.all([sb.from('staff').select('id', { count: 'exact', head: true }).eq('team_id', tid), sb.from('scouts').select('id', { count: 'exact', head: true }).eq('team_id', tid)]);
  const used = (a.count || 0) + (b.count || 0), cap = [28, 19, 11][staffDiv()];
  if (x.team_id) return toast('Ce membre du staff est déjà sous contrat : il doit d\'abord être libre.');
  const roles = Object.keys(STAFF_LABEL).filter((k) => k !== 'SCOUT'), ov = document.createElement('div'); ov.className = 'adm-ov'; ov.id = 'so-modal';
  ov.innerHTML = `<div class="adm-box" style="max-width:600px"><div class="neg-head"><h3 style="margin:0">Signer le contrat : ${esc(x.name)}</h3><button class="link" id="so-x">Fermer</button></div>
    <div class="tm-card"><h5>Exigences du candidat</h5><div class="tm-kv"><span>Rôle souhaité</span><b>${esc(STAFF_LABEL[wantRole] || wantRole)}</b></div><div class="tm-kv"><span>Durée de contrat souhaitée</span><b>${wantYears} an(s) minimum</b></div>
      <div class="tm-kv"><span>Salaire mensuel (fixe, non négociable)</span><b>${fmtEUR(salary)}</b></div><div class="tm-kv"><span>Effectif du staff</span><b>${used} / ${cap}</b></div></div>
    <div class="adm-grid" style="margin-top:.8rem"><div><label>Rôle attribué</label>${sc ? '<select id="so-role" disabled><option>Scout / Éclaireur</option></select>' : selHtml('so-role', roles.map((k) => [k, STAFF_LABEL[k]]), role)}</div>
      <div><label>Durée du contrat</label>${selHtml('so-years', [[1, '1 an'], [2, '2 ans'], [3, '3 ans']], wantYears)}</div></div>
    <div class="tm-bubbles" id="so-say" style="margin-top:.8rem"></div><div class="neg-hint" id="so-err" style="color:#f87171"></div>
    <div class="neg-actions"><button class="link" id="so-x2">Annuler</button><button id="so-send">Signer le contrat</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove(), say = (t, angry) => { $('so-say').innerHTML = `<div class="tm-bubble ${angry ? 'tm-angry' : 'tm-b2'}"><small>${esc(x.name)}</small>${esc(t)}</div>`; };
  $('so-x').onclick = $('so-x2').onclick = close; ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('so-send').onclick = async () => {
    const given = sc ? 'SCOUT' : $('so-role').value, years = +$('so-years').value, err = (m) => { $('so-err').textContent = m; };
    err(''); if (used >= cap) return err('Effectif du staff complet.');
    if (!sc && !staffRoleOk(given, wantRole)) return say(`Ce poste (${STAFF_LABEL[given]}) est trop éloigné de mon métier : je souhaite un rôle de ${STAFF_LABEL[wantRole]}. C'est non.`, true);
    if (years < wantYears) return say(`Une durée de ${years} an(s) est insuffisante : je veux au moins ${wantYears} an(s) de contrat.`, true);
    say('Ce poste et cette durée me conviennent : j\'accepte.'); $('so-send').disabled = true;
    const res = sc ? await sb.rpc('hire_scout', { p_scout: id }) : await sb.rpc('hire_staff_contract', { p_staff: id, p_role: given, p_salary: salary, p_years: years });
    if (res.error) { $('so-send').disabled = false; return say(res.error.message.replace(/^REFUS : /, ''), true); }
    toast(`${x.name} rejoint votre staff (${fmtEUR(salary)} / mois).`);
    setTimeout(() => { close(); state.tab === 'staff_detail' ? renderStaffDetail($('content'), key) : renderTab(); }, 900);
  };
}

async function hireStaff(key) {
  const [src, id] = key.split(':');
  const { error } = src === 'scout' ? await sb.rpc('hire_scout', { p_scout: id }) : await sb.rpc('hire_staff', { p_staff: id });
  if (error) return toast(error.message);
  toast('Membre du staff embauché.'); renderTab();
}

const sdb = { q: '', role: 'all', status: 'all', sort: { k: 'rating', d: -1 } };
async function renderStaffDatabase(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const [st, sc, tm] = await Promise.all([sb.from('staff').select('*'), sb.from('scouts').select('*'), sb.from('teams').select('id, name, official_name')]);
  const tn = Object.fromEntries((tm.data || []).map((t) => [t.id, t.official_name || t.name]));
  const all = [
    ...(st.data || []).map((x) => ({ key: 'staff:' + x.id, name: x.name, role: STAFF_ALIAS[x.role] || x.role, team_id: x.team_id, age: x.age, nat: x.nationality, rating: x.rating, salary: Number(x.monthly_salary || 0) })),
    ...(sc.data || []).map((x) => ({ key: 'scout:' + x.id, name: x.name, role: 'SCOUT', team_id: x.team_id, age: x.age, nat: x.country, rating: Math.round(((x.judging_current_ability + x.judging_potential_ability + x.adaptability) / 3) * 5), salary: Number(x.monthly_salary || 0) })),
  ].map((x) => ({ ...x, team: x.team_id ? tn[x.team_id] || '-' : 'Sans contrat' }));
  c.innerHTML = `<div class="panel full"><h4>Base de données staff</h4><div class="fbar">
    <input id="s-q" placeholder="Nom" value="${esc(sdb.q)}">
    ${selHtml('s-role', [['all', 'Tous les rôles'], ...Object.entries(STAFF_LABEL)], sdb.role)}
    ${selHtml('s-status', [['all', 'Tous les statuts'], ['free', 'Sans contrat / libres'], ['signed', 'Sous contrat']], sdb.status)}</div>
    <div id="sdbtable"></div><p class="muted">Évaluation sur 100 (pour un scout : moyenne CA, PA et adaptabilité). L'exigence salariale correspond au salaire mensuel actuel.</p></div>`;
  const row = (x) => `<tr data-srow="${x.key}" style="cursor:pointer"><td><span class="av">${esc(x.name.split(' ').map((s) => s[0]).slice(0, 2).join(''))}</span>${esc(x.name)}</td><td>${esc(STAFF_LABEL[x.role] || x.role)}</td>
    <td>${x.team_id ? esc(x.team) : '<span class="bd green">Sans contrat</span>'}</td><td>${x.age ?? '-'}</td><td>${x.nat ? flag(x.nat) : '-'}</td>
    <td>${x.rating != null ? `<span class="mini"><i style="width:${x.rating}%"></i></span> ${x.rating}` : '-'}</td><td>${fmtEUR(x.salary)} / mois</td><td><button data-sact="open|${x.key}">Consulter</button></td></tr>`;
  const draw = () => {
    const q = sdb.q.toLowerCase(), { k, d } = sdb.sort;
    const rows = all.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (sdb.role === 'all' || x.role === sdb.role) && (sdb.status === 'all' || (sdb.status === 'free' ? !x.team_id : !!x.team_id)));
    rows.sort((a, b) => { const va = k === 'role' ? STAFF_LABEL[a.role] || a.role : a[k], vb = k === 'role' ? STAFF_LABEL[b.role] || b.role : b[k];
      return (['name', 'role', 'team', 'nat'].includes(k) ? String(va ?? '').localeCompare(String(vb ?? ''), 'fr') : (va ?? -1) - (vb ?? -1)) * d; });
    const cols = [['Nom', 'name'], ['Rôle principal', 'role'], ['Équipe actuelle', 'team'], ['Âge', 'age'], ['Nationalité', 'nat'], ['Évaluation globale', 'rating'], ['Exigence salariale', 'salary'], ['', '']];
    $('sdbtable').innerHTML = `<div class="muted">${rows.length} membre(s)${rows.length > 100 ? ' (100 premiers affichés)' : ''}</div><div class="tbl tall"><table class="fm sq"><thead><tr>${cols.map(([l, key]) => `<th ${key ? `data-ssort="${key}"` : ''}>${l}${key === k ? (d < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 100).map(row).join('') || '<tr><td colspan="8" class="muted">Aucun membre du staff ne correspond.</td></tr>'}</tbody></table></div>`;
  };
  c.querySelectorAll('.fbar [id^="s-"]').forEach((el) => { el.oninput = () => { sdb[{ 's-q': 'q', 's-role': 'role', 's-status': 'status' }[el.id]] = el.value; draw(); }; });
  bindStaffNav(c);
  const base = c.onclick;
  c.onclick = (e) => {
    const th = e.target.closest('th[data-ssort]');
    if (th) { const key = th.dataset.ssort; sdb.sort = sdb.sort.k === key ? { k: key, d: -sdb.sort.d } : { k: key, d: ['name', 'role', 'team', 'nat'].includes(key) ? 1 : -1 }; return draw(); }
    base(e);
  };
  draw();
}
/* ===== Moteur d'impact du staff et des langues ===== */
const SI_LANG_CODE = { Français: 'FR', Anglais: 'EN', Italien: 'IT', Espagnol: 'ES', Allemand: 'DE', Néerlandais: 'NL', Danois: 'DA', Portugais: 'PT', Norvégien: 'NO', Suédois: 'SV' };
const SI_NATIVE = { FR: 'FR', BE: 'FR', LU: 'FR', IT: 'IT', ES: 'ES', PT: 'PT', DE: 'DE', AT: 'DE', CH: 'DE', NL: 'NL', DK: 'DA', NO: 'NO', SE: 'SV', GB: 'EN', IE: 'EN', US: 'EN', CA: 'EN', AU: 'EN', NZ: 'EN' };
const SI_EN = { NL: 1, DK: 1, NO: 1, SE: 1, DE: 0.9, AT: 0.85, BE: 0.8, CH: 0.8, SI: 0.8, PL: 0.6, CZ: 0.6, FR: 0.5, PT: 0.5, IT: 0.45, ES: 0.45 };   // part de coureurs parlant anglais (hors colonne languages)
const SI_COACH = ['HEAD_DS', 'DS', 'TRAINER', 'TACTICS'];
const SI_GROUPS = { recov: ['PHYSIO', 'DOCTOR', 'NUTRITIONIST', 'TRAINER'], talent: ['SCOUT', 'RECRUIT_HEAD', 'ANALYST'], motiv: ['TRAINER', 'DS', 'HEAD_DS'], race: ['HEAD_DS', 'DS', 'TACTICS'] };
const SI_CTX = {};   // contexte calculé par équipe : SI_CTX[teamId]
const siLang = (l) => SI_LANG_CODE[l] || String(l).toUpperCase();
const siClamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Langues d'un coureur ou d'un membre du staff : liste enregistrée (codes ou noms), sinon langue maternelle du pays + anglais selon le pays
function siLangs(p) {
  if (Array.isArray(p.languages) && p.languages.length) return [...new Set(p.languages.map(siLang))];
  const nat = p.nationality || p.country || '', native = SI_NATIVE[nat] || nat, out = [native];
  if (native !== 'EN' && (hashN(String(p.id) + 'en') % 100) / 100 < (SI_EN[nat] ?? 0.55)) out.push('EN');
  return out;
}

// À appeler avant chaque simulation / passage de jour : charge le staff, les langues et calcule les bonus de l'équipe
async function loadStaffImpactCtx(teamId) {
  const ids = [teamId, ...(state.devTeam && state.team && teamId === state.team.id ? [state.devTeam.id] : [])];
  const [st, sc, rs] = await Promise.all([
    sb.from('staff').select('*').eq('team_id', teamId),
    sb.from('scouts').select('*').eq('team_id', teamId),
    sb.from('riders').select('*').in('team_id', ids),
  ]);
  const members = [
    ...(st.data || []).map((x) => { const role = STAFF_ALIAS[x.role] || x.role; return { role, name: x.name, langs: siLangs(x), A: staffAttrs(x, role) };}),
    ...(sc.data || []).map((x) => ({ role: 'SCOUT', name: x.name, langs: siLangs(x), A: staffAttrs({ id: x.id, rating: Math.round(((x.judging_current_ability + x.judging_potential_ability + x.adaptability) / 3) * 5) }, 'SCOUT') })),
  ];
  const count = {};
  [...(rs.data || []).map((r) => siLangs(r)), ...members.map((m) => m.langs)].forEach((l) => l.forEach((k) => (count[k] = (count[k] || 0) + 1)));
  const major = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EN';                     // langue majoritaire de l'équipe
  const top = (roles, key, n = 2) => {                                                                    // moyenne des 2 meilleures notes du pôle (40 si pôle vide)
    const v = members.filter((m) => roles.includes(m.role)).map((m) => m.A[key]).sort((a, b) => b - a).slice(0, n);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 40;
  };
  const R = (top(SI_GROUPS.recov, 'recov') + top(SI_GROUPS.recov, 'prep')) / 200, Y = (top(SI_GROUPS.talent, 'talent') + top(SI_GROUPS.motiv, 'motiv')) / 200, S = top(SI_GROUPS.race, 'race') / 100;
  SI_CTX[teamId] = {
    coaches: members.filter((m) => SI_COACH.includes(m.role)),
    workLangs: [...new Set(['EN', major])], coachLangs: new Set(members.filter((m) => SI_COACH.includes(m.role)).flatMap((m) => m.langs)),
    fatigueRec: 1 - siClamp((R - 0.5) * 0.4, 0, 0.2),      // jusqu'à -20 % de fatigue accumulée (préparation physique + récupération)
    recoveryMult: 1 + siClamp((R - 0.5) * 0.6, 0, 0.3),    // jusqu'à +30 % de vitesse de récupération de forme
    youthMult: 1 + siClamp((Y - 0.5) * 0.8, 0, 0.4),       // jusqu'à +40 % de progression des U23 (détection de jeunes + motivation)
    raceBonus: 1 + siClamp((S - 0.5) * 0.1, 0, 0.05),      // jusqu'à +5 % de performance en course (stratégie des directeurs sportifs)
    scores: { R, Y, S }, at: Date.now(),
  };
  return SI_CTX[teamId];
}

// rider : { id, nationality, age, languages? } → multiplicateurs à appliquer par le moteur de jeu
//   fatigue accumulée × fatigueMult · récupération de forme × recoveryMult · progression × progressMult · SPV de course × raceBonus
function calculateStaffImpact(teamId, rider, ctx = SI_CTX[teamId]) {
  if (!ctx) return { language: { speaks: true, covered: false, penalized: false, workLangs: ['EN'], trainingMult: 1, fatigueMult: 1 }, fatigueMult: 1, recoveryMult: 1, trainingMult: 1, youthMult: 1, progressMult: 1, raceBonus: 1, notes: ['Contexte du staff non chargé : appelez loadStaffImpactCtx(teamId).'] };
  const langs = siLangs(rider), speaks = langs.some((l) => ctx.workLangs.includes(l)), covered = langs.some((l) => ctx.coachLangs.has(l)), penalized = !speaks && !covered;
  const language = { langs, speaks, covered, penalized, workLangs: ctx.workLangs, trainingMult: penalized ? 0.85 : 1, fatigueMult: penalized ? 1.1 : 1 };
  const youthMult = rider.age <= 22 ? ctx.youthMult : 1, notes = [];
  if (penalized) notes.push("Barrière de la langue : -15 % d'efficacité d'entraînement, +10 % de fatigue (aucun encadrant ne parle sa langue).");
  else if (!speaks) notes.push('Barrière de la langue compensée : un encadrant parle sa langue.');
  if (ctx.fatigueRec < 1) notes.push(`Staff de récupération : fatigue -${Math.round((1 - ctx.fatigueRec) * 100)} %, récupération +${Math.round((ctx.recoveryMult - 1) * 100)} %.`);
  if (youthMult > 1) notes.push(`Détection et motivation : progression des jeunes +${Math.round((youthMult - 1) * 100)} %.`);
  if (ctx.raceBonus > 1) notes.push(`Stratégie de course : +${((ctx.raceBonus - 1) * 100).toFixed(1)} % de performance.`);
  return { language, fatigueMult: language.fatigueMult * ctx.fatigueRec, recoveryMult: ctx.recoveryMult, trainingMult: language.trainingMult, youthMult, progressMult: language.trainingMult * youthMult, raceBonus: ctx.raceBonus, notes };
}

/* ===== Photos de coureurs, de staff et de managers (URL + recadrage) ===== */
const PHOTO_TABLES = { rider: 'riders', staff: 'staff', scout: 'scouts', manager: 'managers' };
const initialsOf = (p) => esc((p.first_name ? p.first_name[0] + (p.last_name || '')[0] : String(p.name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('')).toUpperCase());
const refreshManager = async () => { const { data } = await sb.from('managers').select('*').eq('user_id', state.user.id).maybeSingle(); if (data) state.manager = data; };
function getPersonAvatar(person, type = 'rider') {
  const url = person.photo_url || person.avatar, fallback = `<div class="rav">${initialsOf(person)}</div>`;
  if (!url || !/^https?:\/\//i.test(url)) return fallback;
  const c = person.photo_crop || {}, z = c.z || 1, x = c.x ?? 50, y = c.y ?? 50;
  return `<span class="avatar-img-wrap"><img src="${esc(url)}" class="avatar-img" alt="" referrerpolicy="no-referrer" style="object-position:${x}% ${y}%;transform:scale(${z});transform-origin:${x}% ${y}%" data-fb="${esc(fallback)}" onerror="this.parentNode.outerHTML=this.dataset.fb"></span>`;
}
const avatarWithEdit = (person, type) => `<div class="rav-wrap">${getPersonAvatar(person, type)}<div class="rav-tools"><button type="button" data-photo="${type}|${person.id}" title="Changer la photo (URL)">Photo</button><button type="button" data-crop="${type}|${person.id}" title="Recadrer la photo">Recadrer</button></div></div>`;

async function editPersonPhoto(type, id) {
  const table = PHOTO_TABLES[type]; if (!table) return;
  const { data } = await sb.from(table).select('photo_url').eq('id', id).maybeSingle();
  const url = prompt("Collez l'URL d'une image (lien direct .png ou .jpg). Laissez vide pour retirer la photo.", data?.photo_url || '');
  if (url === null) return;
  const clean = url.trim();
  if (clean && !/^https?:\/\/\S+$/i.test(clean)) return toast('URL invalide : elle doit commencer par http:// ou https://');
  const { error } = await sb.rpc('set_person_photo', { p_kind: type, p_id: id, p_url: clean });
  if (error) return toast(error.message);
  if (type === 'manager') await refreshManager();
  toast(clean ? 'Photo enregistrée : utilisez « Recadrer » pour la cadrer.' : 'Photo retirée.'); renderTab();
}

async function openPhotoCropper(type, id) {
  const table = PHOTO_TABLES[type]; if (!table) return;
  const { data: p } = await sb.from(table).select('photo_url, photo_crop').eq('id', id).maybeSingle();
  if (!p?.photo_url) return toast('Ajoutez d\'abord une photo avec le bouton « Photo ».');
  const cr = { z: 1, x: 50, y: 50, ...(p.photo_crop || {}) }, ov = document.createElement('div'); ov.className = 'adm-ov'; ov.id = 'crop-modal';
  ov.innerHTML = `<div class="adm-box" style="max-width:440px"><div class="neg-head"><h3 style="margin:0">Recadrer la photo</h3><button class="link" id="cr-close">Fermer</button></div>
    <div style="display:flex;justify-content:center;margin-bottom:1rem"><span class="avatar-img-wrap" style="width:180px;height:180px"><img id="cr-img" src="${esc(p.photo_url)}" class="avatar-img" alt="" referrerpolicy="no-referrer"></span></div>
    <label>Zoom : <b id="cr-zv"></b></label><input id="cr-z" type="range" min="1" max="3" step="0.05" value="${cr.z}">
    <label style="margin-top:.6rem">Position horizontale</label><input id="cr-sx" type="range" min="0" max="100" value="${cr.x}">
    <label style="margin-top:.6rem">Position verticale</label><input id="cr-sy" type="range" min="0" max="100" value="${cr.y}">
    <div class="neg-actions"><button class="link" id="cr-reset">Réinitialiser</button><button class="link" id="cr-cancel">Annuler</button><button id="cr-save">Enregistrer</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove(), val = () => ({ z: +$('cr-z').value, x: +$('cr-sx').value, y: +$('cr-sy').value });
  const apply = () => { const v = val(), im = $('cr-img'); im.style.objectPosition = `${v.x}% ${v.y}%`; im.style.transform = `scale(${v.z})`; im.style.transformOrigin = `${v.x}% ${v.y}%`; $('cr-zv').textContent = '×' + v.z.toFixed(2); };
  ['cr-z', 'cr-sx', 'cr-sy'].forEach((i) => ($(i).oninput = apply)); apply();
  $('cr-close').onclick = $('cr-cancel').onclick = close; ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('cr-reset').onclick = () => { $('cr-z').value = 1; $('cr-sx').value = 50; $('cr-sy').value = 50; apply(); };
  $('cr-save').onclick = async () => {
    const { error } = await sb.rpc('set_person_crop', { p_kind: type, p_id: id, p_crop: val() });
    if (error) return toast(error.message);
    if (type === 'manager') await refreshManager();
    toast('Recadrage enregistré.'); close(); renderTab();
  };
}
if (!window.photoBound) {
  window.photoBound = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-photo]'), k = e.target.closest('[data-crop]');
    if (b) { const [t, id] = b.dataset.photo.split('|'); editPersonPhoto(t, id); }
    else if (k) { const [t, id] = k.dataset.crop.split('|'); openPhotoCropper(t, id); }
  });
}

/* ===== ENTRAÎNEMENT : vue d'ensemble et planning hebdomadaire ===== */
const TRN_SLOTS = [
  ['Matin', [['Endurance fondamentale', 'build'], ['PMA / Bosses', 'hard'], ['Contre-la-montre', 'hard'], ['Sprint & train', 'hard'], ['Repos', 'rest']]],
  ['Après-midi', [['Musculation / Gainage', 'build'], ['Tactique de course', 'tact'], ['Reconnaissance', 'tact'], ['Récupération active', 'rec'], ['Repos', 'rest']]],
  ['Soir', [['Soins & physiothérapie', 'rec'], ['Repos', 'rest']]],
];
const TRN_PATTERN = { 1: ['Endurance fondamentale', 'Musculation / Gainage', 'Soins & physiothérapie'], 2: ['PMA / Bosses', 'Tactique de course', 'Soins & physiothérapie'],
  3: ['Sprint & train', 'Récupération active', 'Soins & physiothérapie'], 4: ['Contre-la-montre', 'Musculation / Gainage', 'Soins & physiothérapie'],
  5: ['Endurance fondamentale', 'Reconnaissance', 'Soins & physiothérapie'], 6: ['PMA / Bosses', 'Récupération active', 'Soins & physiothérapie'], 0: ['Repos', 'Repos', 'Repos'] };
const trnIso = (d) => d.toISOString().slice(0, 10);
const trnAdd = (iso, n) => { const d = gd(iso); d.setDate(d.getDate() + n); return trnIso(d); };
const trnMonday = (iso) => trnAdd(iso, -((gd(iso).getDay() + 6) % 7));

// Jours bloqués : course (tous les créneaux) + voyage la veille et le lendemain si la course est à plus de 300 km du siège
function trnLocked(races) {
  const m = {}, put = (iso, o) => { if (!m[iso] || o.type === 'RACE') m[iso] = o; };
  races.forEach((r) => {
    put(r.date, { type: 'RACE', label: r.name });
    if ((r.travel_km || 0) > 300) { put(trnAdd(r.date, -1), { type: 'TRAVEL', label: `Voyage : ${r.name} (${r.travel_km} km)` }); put(trnAdd(r.date, 1), { type: 'TRAVEL', label: `Retour : ${r.name}` }); }
  });
  return m;
}
// Planning proposé par le Directeur sportif (mode délégué et bouton « Planning automatique »)
function trnAuto(iso, races) {
  const next = races.filter((r) => r.date > iso)[0], prev = races.filter((r) => r.date < iso).slice(-1)[0];
  const dn = next ? Math.round((gd(next.date) - gd(iso)) / 864e5) : 99, dp = prev ? Math.round((gd(iso) - gd(prev.date)) / 864e5) : 99;
  if (dp === 1) return ['Repos', 'Récupération active', 'Soins & physiothérapie'];
  if (dn === 1) return ['Endurance fondamentale', 'Tactique de course', 'Soins & physiothérapie'];
  return TRN_PATTERN[gd(iso).getDay()];
}

async function renderTrainingOverview(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const t = state.team, g = state.game;
  const [rc, sch, set] = await Promise.all([
    sb.from('races').select('*').order('date'),
    sb.from('training_schedule').select('day, slots').eq('team_id', t.id),
    sb.from('training_settings').select('delegated').eq('team_id', t.id).maybeSingle(),
  ]);
  if (sch.error) { c.innerHTML = `<div class="panel"><h4>Entraînement</h4><p class="err">${esc(sch.error.message)} : lancez le script SQL de l'entraînement dans Supabase.</p></div>`; return; }
  const races = rc.data || [], locked = trnLocked(races), nr = state.nextRace, away = nr && (nr.travel_km || 0) > 300;
  state.trainingSchedule = Object.fromEntries((sch.data || []).map((x) => [x.day, x.slots])); state.trnDelegated = !!set.data?.delegated; state.trnWeek = state.trnWeek || trnMonday(g.game_date);
  const weekDays = () => [...Array(7)].map((_, i) => trnAdd(state.trnWeek, i)), slotsOf = (iso) => (state.trnDelegated ? trnAuto(iso, races) : state.trainingSchedule[iso] || []);
  const three = (iso) => [0, 1, 2].map((k) => (state.trainingSchedule[iso] || [])[k] || '');
  const save = async (rows) => {
    if (!rows.length) return;
    rows.forEach((r) => (state.trainingSchedule[r.day] = r.slots));
    const { error } = await sb.from('training_schedule').upsert(rows.map((r) => ({ team_id: t.id, day: r.day, slots: r.slots })), { onConflict: 'team_id,day' });
    if (error) toast(error.message); else if ($('trn-status')) $('trn-status').textContent = 'Planning enregistré';
  };
  const cell = (iso, s) => {
    const L = locked[iso];
    if (L) return `<div class="trn-c ${L.type === 'RACE' ? 'race' : 'travel'}">${L.type === 'RACE' ? 'Course' : 'Voyage / Logistique'}<small>${esc(L.label)}</small></div>`;
    const cur = slotsOf(iso)[s] || '', kind = (TRN_SLOTS[s][1].find((a) => a[0] === cur) || [])[1] || 'none';
    return state.trnDelegated ? `<div class="trn-c ${kind}">${esc(cur || '-')}</div>`
      : `<select class="trn-c ${kind}" data-trn="${iso}|${s}"><option value="">-</option>${TRN_SLOTS[s][1].map(([a]) => `<option ${a === cur ? 'selected' : ''}>${a}</option>`).join('')}</select>`;
  };
  const draw = () => {
    const days = weekDays();
    c.innerHTML = `<div class="trn-top">
      <div class="panel"><h4>Responsabilités</h4><div class="tabs"><button data-trd="0" class="${state.trnDelegated ? '' : 'on'}">Géré par le Manager</button><button data-trd="1" class="${state.trnDelegated ? 'on' : ''}">Délégué au Directeur sportif</button></div>
        <p class="muted">${state.trnDelegated ? 'Le Directeur sportif construit le planning automatiquement (lecture seule).' : 'Vous composez le planning de chaque semaine.'}</p></div>
      <div class="panel"><h4>Prochaine course</h4>${nr ? `<div class="big">${esc(nr.name)}</div><div class="muted">${fmtShort(nr.date)} · ${PROFILES[nr.profile_type] || ''} · ${nr.distance_km || '?'} km · dans ${Math.max(0, daysUntil(nr.date))} jour(s)</div>
        <div class="stat-row"><span>Déplacement</span><b class="${away ? 'down' : ''}">${away ? nr.travel_km + ' km : veille et lendemain bloqués' : 'Course proche : pas de voyage'}</b></div>` : '<p class="muted">Aucune course prévue.</p>'}</div></div>
      <div class="panel full"><h4>Planning d'entraînement</h4>
        <div class="sq-bar"><div class="sq-ctl"><button data-trw="-7">&lt;</button><b style="text-transform:capitalize;align-self:center">${gd(state.trnWeek).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</b><button data-trw="7">&gt;</button><button data-trw="0">Aujourd'hui</button></div>
          <div class="sq-ctl">${state.trnDelegated ? '' : '<button data-tra="auto">Planning automatique</button><button data-tra="copy">Copier la semaine</button><button data-tra="paste">Coller</button><button class="danger" data-tra="clear">Effacer</button>'}</div></div>
        <div class="tbl"><div class="trn-grid"><div></div>${days.map((iso) => `<div class="trn-h ${iso === g.game_date ? 'today' : ''}">${DAYS[gd(iso).getDay()]}<small>${fmtShort(iso)}</small></div>`).join('')}
          ${TRN_SLOTS.map(([label], s) => `<div class="trn-l">${label}</div>${days.map((iso) => `<div>${cell(iso, s)}</div>`).join('')}`).join('')}</div></div>
        <div class="muted" id="trn-status" style="margin-top:.5rem"></div>
        <div class="muted">Course : tous les créneaux sont pris. Voyage / Logistique : veille et lendemain d'une course à plus de 300 km, aucun entraînement possible.</div></div>`;
  };
  c.onchange = (e) => {
    const s = e.target.closest('[data-trn]'); if (!s) return;
    const [iso, i] = s.dataset.trn.split('|'), arr = three(iso); arr[+i] = s.value; save([{ day: iso, slots: arr }]).then(draw);
  };
  c.onclick = async (e) => {
    const b = e.target.closest('[data-trd],[data-trw],[data-tra]'); if (!b) return;
    if (b.dataset.trd !== undefined) { state.trnDelegated = b.dataset.trd === '1'; await sb.from('training_settings').upsert({ team_id: t.id, delegated: state.trnDelegated }, { onConflict: 'team_id' }); return draw(); }
    if (b.dataset.trw !== undefined) { state.trnWeek = b.dataset.trw === '0' ? trnMonday(g.game_date) : trnAdd(state.trnWeek, +b.dataset.trw); return draw(); }
    const free = weekDays().filter((iso) => !locked[iso]), act = b.dataset.tra;
    if (act === 'auto') await save(free.map((iso) => ({ day: iso, slots: trnAuto(iso, races) })));
    if (act === 'clear') await save(free.map((iso) => ({ day: iso, slots: ['', '', ''] })));
    if (act === 'copy') { state.trnClip = weekDays().map((iso) => (locked[iso] ? null : three(iso))); return toast('Semaine copiée.'); }
    if (act === 'paste') { if (!state.trnClip) return toast("Copiez d'abord une semaine."); await save(weekDays().map((iso, i) => (state.trnClip[i] && !locked[iso] ? { day: iso, slots: state.trnClip[i] } : null)).filter(Boolean)); }
    draw();
  };
  draw();
}

/* ===== ENTRAÎNEMENT INDIVIDUEL ===== */
const IT_FOCUS = [['CLIMB', 'Montagne / Grimpeur'], ['TT', 'Contre-la-montre'], ['SPRINT', 'Sprint & explosivité'], ['HILLS', 'Vallons & agressivité'], ['ENDURANCE', 'Endurance & caisse'], ['ALL', 'Polyvalence']];
const IT_INT = [['DOUBLE', 'Double intensité'], ['NORMAL', 'Normal'], ['HALF', 'Demi-intensité'], ['REST', 'Repos forcé']];
const IT_ATTRS = { CLIMB: ['MTN', 'MM', 'STA', 'REC'], TT: ['TTR', 'PRL', 'FLA', 'RES'], SPRINT: ['SPR', 'ACC', 'ATT'], HILLS: ['HIL', 'ATT', 'ACC', 'DHI'], ENDURANCE: ['STA', 'RES', 'REC', 'FLA'], ALL: ['MTN', 'HIL', 'FLA', 'SPR', 'TTR'] };
const itBonus = (m) => (m ? Math.max(0, Math.min(0.7, ((m.A.prep + m.A.motiv + m.A.race) / 3 - 55) / 60)) : 0);   // bonus du référent (préparation, motivation, stratégie)
const itColor = (v) => (v >= 8 ? 'up' : v >= 6.5 ? '' : 'down');
const itRating = (r, p, bonus) => {
  const base = 5.7 + (hashN(r.id + 'trn') % 16) / 10, inten = { DOUBLE: 0.5, NORMAL: 0.2, HALF: -0.3, REST: -0.8 }[p.intensity] ?? 0.2;
  const fat = -((r.fatigue || 0) / 100) * (p.intensity === 'DOUBLE' ? 2 : 1), inj = r.injured ? (p.rehab ? 0.6 : -0.8) : 0;
  return Math.max(1, Math.min(10, base + inten + fat + bonus + inj));
};

async function renderIndividualTraining(c) {
  await ensureStaffCtx();
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const t = state.team, g = state.game;
  const [rs, st, pl] = await Promise.all([sb.from('riders').select('*').in('team_id', myTeamIds()), sb.from('staff').select('*').eq('team_id', t.id), sb.from('individual_training').select('*').eq('team_id', t.id)]);
  if (pl.error) { c.innerHTML = `<div class="panel"><h4>Entraînement individuel</h4><p class="err">${esc(pl.error.message)} : lancez le script SQL de l'entraînement individuel dans Supabase.</p></div>`; return; }
  const riders = (rs.data || []).map((r) => ({ ...r, injured: !!(r.injured_until && r.injured_until > g.game_date) })).sort((a, b) => a.last_name.localeCompare(b.last_name, 'fr'));
  const coaches = (st.data || []).map((x) => { const role = STAFF_ALIAS[x.role] || x.role; return { key: 'staff:' + x.id, name: x.name, role, A: staffAttrs(x, role) }; }).filter((m) => ['HEAD_DS', 'DS', 'TRAINER', 'TACTICS'].includes(m.role));
  const medical = (st.data || []).filter((x) => ['DOCTOR', 'PHYSIO', 'MASSEUR'].includes(x.role)).length;
  const plans = Object.fromEntries((pl.data || []).map((p) => [p.rider_id, p])), planOf = (id) => plans[id] || { focus: 'ALL', intensity: 'NORMAL', rehab: false, coach: null };
  const rate = (r) => itRating(r, planOf(r.id), itBonus(coaches.find((m) => m.key === planOf(r.id).coach)));
  if (!riders.some((r) => r.id === state.itSel)) state.itSel = riders[0]?.id; state.itQ = state.itQ || '';
  const save = async (r, patch) => {
    const p = { ...planOf(r.id), ...patch }; plans[r.id] = p;
    const { error } = await sb.from('individual_training').upsert({ team_id: t.id, rider_id: r.id, focus: p.focus, intensity: p.intensity, rehab: p.rehab, coach: p.coach }, { onConflict: 'team_id,rider_id' });
    if (error) toast(error.message); draw();
  };
  const listHTML = () => riders.filter((r) => !state.itQ || (r.first_name + ' ' + r.last_name).toLowerCase().includes(state.itQ.toLowerCase())).map((r) => { const v = rate(r);
    return `<div class="it-row ${r.id === state.itSel ? 'sel' : ''}" data-itsel="${r.id}"><span class="av">${esc(r.first_name[0] + r.last_name[0])}</span><span class="it-n">${esc(r.first_name)} ${esc(r.last_name)}${r.injured ? ' <span class="bd red">Blessé</span>' : ''}</span><b class="${itColor(v)}">${v.toFixed(2)} / 10</b></div>`; }).join('') || '<p class="muted">Aucun coureur.</p>';
  const detail = () => {
    const r = riders.find((x) => x.id === state.itSel); if (!r) return '<p class="muted pad">Aucun coureur sélectionné.</p>';
    const p = planOf(r.id), m = coaches.find((x) => x.key === p.coach), bonus = itBonus(m), A = attrsOf(r), hl = IT_ATTRS[p.focus] || [], up = p.intensity === 'DOUBLE' || p.intensity === 'NORMAL', rating = rate(r);
    const opts = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
    const row = ([code, label]) => { const on = hl.includes(code); return `<div class="arow ${on ? 'it-hl' : ''}"><span><b>${code}</b> <span class="muted">${label}</span></span><span>${on ? `<span class="tr ${up ? 'up' : 'flat'}">${up ? '▲' : '►'}</span>` : ''}<span class="an ${tone(A[code])}">${A[code]}</span></span></div>`; };
    return `<div class="rhead" style="margin-bottom:.75rem">${avatarWithEdit(r, 'rider')}<div class="rid"><div class="rname">${esc(r.first_name)} ${esc(r.last_name)}</div><div class="muted">${r.age} ans · ${flag(r.nationality)} · Forme de course ${Math.round(r.fitness ?? 70)} % · Fatigue ${r.fatigue || 0} %</div><div class="muted">Langues : ${esc(siLangs(r).map(siLabel).join(', '))} · ${calculateStaffImpact(t.id, r).language.penalized ? '<span class="down">barrière de la langue : -15 % entraînement, +10 % fatigue</span>' : '<span class="up">communication avec le staff OK</span>'}</div></div>
        <div class="rbox"><div class="muted">Note d'entraînement</div><b class="${itColor(rating)}">${rating.toFixed(2)} / 10</b></div></div>
      <div class="rcols"><div class="panel"><h4>Programme individuel</h4>
          <label>Focus individuel</label><select data-itf>${opts(IT_FOCUS, p.focus)}</select>
          <label style="margin-top:.6rem">Intensité individuelle</label><select data-iti>${opts(IT_INT, p.intensity)}</select>
          ${p.intensity === 'DOUBLE' ? '<p class="down" style="font-size:.8rem">Double intensité : progression plus rapide, mais fatigue et risque de blessure accrus.</p>' : p.intensity === 'REST' ? '<p class="muted" style="font-size:.8rem">Repos forcé : aucune progression, récupération maximale.</p>' : ''}
          <label style="margin-top:.6rem">Entraîneur / staff référent</label><select data-itc ${coaches.length ? '' : 'disabled'}><option value="">Aucun</option>${coaches.map((x) => `<option value="${x.key}" ${x.key === p.coach ? 'selected' : ''}>${esc(x.name)} · ${esc(STAFF_LABEL[x.role] || x.role)} (+${Math.round(itBonus(x) * 30)} %)</option>`).join('')}</select>
          <p class="muted" style="font-size:.8rem">${m ? `Bonus de progression : +${Math.round(bonus * 30)} % (préparation, motivation et stratégie de ${esc(m.name)}).` : coaches.length ? 'Aucun référent : pas de bonus.' : 'Aucun entraîneur ni directeur sportif dans votre staff : embauchez-en un (CLUB → Base de données staff).'}</p></div>
        <div class="panel"><h4>Rééducation & médical</h4>${r.injured ? `<div class="stat-row"><span>Blessure</span><b class="down">${esc(r.injury_type || 'Blessure')}</b></div><div class="stat-row"><span>Retour prévu</span><b>${fmtShort(r.injured_until)}</b></div>
            <div class="stat-row"><span>Programme de rééducation</span><b class="${p.rehab ? 'up' : ''}">${p.rehab ? 'Actif' : 'Inactif'}</b></div>
            <button data-itrehab ${medical || p.rehab ? '' : 'disabled'} style="margin-top:.5rem">${p.rehab ? 'Arrêter la rééducation' : 'Activer la rééducation / reconstitution physique'}</button>
            <p class="muted" style="font-size:.8rem">${medical ? 'Supervisé par votre médecin / kiné : retour plus rapide et reprise progressive.' : 'Aucun médecin ni kiné dans votre staff : rééducation impossible.'}</p>` : '<p class="muted">Aucune blessure en cours : pas de rééducation nécessaire.</p>'}</div>
        <div class="panel"><h4>Légende</h4><p class="muted" style="font-size:.85rem">Les notes en surbrillance sont celles travaillées par le focus « ${esc(IT_FOCUS.find((f) => f[0] === p.focus)[1])} ».</p></div></div>
      <div class="rcols" style="grid-template-columns:1fr 1fr">${ATTR_BLOCKS.map(([title, list]) => `<div class="panel"><h4>${title}</h4>${list.map(row).join('')}</div>`).join('')}</div>`;
  };
  const draw = () => {
    c.innerHTML = `<div class="it-layout"><aside class="panel"><h4>Effectif (${riders.length})</h4><input id="it-q" placeholder="Rechercher un coureur" value="${esc(state.itQ)}"><div class="it-list" id="it-list">${listHTML()}</div></aside><section>${detail()}</section></div>`;
    $('it-q').oninput = (e) => { state.itQ = e.target.value; $('it-list').innerHTML = listHTML(); };
  };
  c.onclick = (e) => {
    const s = e.target.closest('[data-itsel]'), rh = e.target.closest('[data-itrehab]');
    if (s) { state.itSel = s.dataset.itsel; draw(); }
    else if (rh) { const r = riders.find((x) => x.id === state.itSel); save(r, { rehab: !planOf(r.id).rehab }); }
  };
  c.onchange = (e) => {
    const r = riders.find((x) => x.id === state.itSel), el = e.target; if (!r) return;
    if (el.matches('[data-itf]')) save(r, { focus: el.value }); else if (el.matches('[data-iti]')) save(r, { intensity: el.value }); else if (el.matches('[data-itc]')) save(r, { coach: el.value || null });
  };
  draw();
}

/* ===== Langues affichées sur les fiches ===== */
const SI_LANG_NAME = { FR: 'Français', EN: 'Anglais', IT: 'Italien', ES: 'Espagnol', DE: 'Allemand', NL: 'Néerlandais', DA: 'Danois', PT: 'Portugais', NO: 'Norvégien', SV: 'Suédois' };
const siLabel = (l) => SI_LANG_NAME[l] || l;
async function ensureStaffCtx() { const c = SI_CTX[state.team.id]; if (!c || Date.now() - c.at > 60000) await loadStaffImpactCtx(state.team.id); return SI_CTX[state.team.id]; }
function riderLangHTML(r) {
  const ctx = SI_CTX[state.team.id], L = calculateStaffImpact(state.team.id, r, ctx).language, langs = L.langs || siLangs(r), mates = (ctx?.coaches || []).filter((m) => m.langs.some((l) => langs.includes(l)));
  const status = L.speaks ? `Langue de travail maîtrisée (${L.workLangs.filter((l) => langs.includes(l)).map(siLabel).join(', ')})` : L.covered ? "Barrière compensée par l'encadrement" : 'Barrière de la langue : -15 % entraînement, +10 % fatigue';
  return `<div class="stat-row"><span>Langues parlées</span><b>${esc(langs.map(siLabel).join(', '))}</b></div>
    <div class="stat-row"><span>Communication avec le staff</span><b class="${L.penalized ? 'down' : 'up'}">${esc(status)}</b></div>
    <div class="stat-row"><span>Encadrants compatibles</span><b>${mates.length ? esc(mates.map((m) => m.name).join(', ')) : 'Aucun'}</b></div>`;
}

/* ===== MOTEUR D'IMPACT DE L'ENTRAÎNEMENT ===== */
const TE_LOAD = [
  { 'Endurance fondamentale': 0.55, 'PMA / Bosses': 0.9, 'Contre-la-montre': 0.85, 'Sprint & train': 0.85, Repos: 0 },
  { 'Musculation / Gainage': 0.6, 'Tactique de course': 0.2, Reconnaissance: 0.4, 'Récupération active': 0.15, Repos: 0 },
  { 'Soins & physiothérapie': 0.05, Repos: 0 },
];
const TE_W = [0.5, 0.35, 0.15];   // poids des 3 créneaux dans la charge du jour
const TE_EX_ATTRS = { 'Endurance fondamentale': ['STA', 'RES', 'REC', 'FLA'], 'PMA / Bosses': ['MTN', 'MM', 'HIL', 'ACC'], 'Contre-la-montre': ['TTR', 'PRL', 'RES'], 'Sprint & train': ['SPR', 'ACC'], 'Musculation / Gainage': ['ACC', 'SPR', 'COB'], Reconnaissance: ['DHI'] };
const TE_MULT = { DOUBLE: 1.5, NORMAL: 1, HALF: 0.6, REST: 0.1 };   // intensité individuelle
const TE_COLS = ['mtn', 'mm', 'hil', 'dhi', 'att', 'ttr', 'prl', 'fla', 'cob', 'spr', 'acc', 'sta', 'res', 'rec'];
const teClamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Appelée par l'admin à chaque passage de jour (continueGame). Traite les équipes jouées et leur équipe de développement.
async function applyTrainingEffects(daysPassed = 1, startIso = state.game.game_date) {
  if (!state.isAdmin) return null;
  const { data: pro } = await sb.from('teams').select('id').not('manager_id', 'is', null);
  if (!(pro || []).length) return null;
  const pids = pro.map((x) => x.id), { data: kids } = await sb.from('teams').select('id, parent_team_id').in('parent_team_id', pids), tids = [...pids, ...(kids || []).map((x) => x.id)];
  const [rs, st, sc, se, it, rc] = await Promise.all([
    sb.from('riders').select('*').in('team_id', tids), sb.from('staff').select('*').in('team_id', pids),
    sb.from('training_schedule').select('*').in('team_id', pids).gte('day', trnAdd(startIso, -6)).lte('day', trnAdd(startIso, daysPassed)),
    sb.from('training_settings').select('*').in('team_id', pids), sb.from('individual_training').select('*').in('team_id', pids), sb.from('races').select('*').order('date'),
  ]);
  if (rs.error || sc.error) throw new Error((rs.error || sc.error).message);
  const races = rc.data || [], locked = trnLocked(races), ownerOf = (id) => (pids.includes(id) ? id : (kids || []).find((k) => k.id === id)?.parent_team_id), T = {};
  for (const id of pids) {
    const members = (st.data || []).filter((x) => x.team_id === id).map((x) => { const role = STAFF_ALIAS[x.role] || x.role; return { key: 'staff:' + x.id, role, A: staffAttrs(x, role) }; });
    T[id] = { ctx: await loadStaffImpactCtx(id), members, medical: members.filter((m) => ['DOCTOR', 'PHYSIO'].includes(m.role)).length,
      delegated: !!(se.data || []).find((x) => x.team_id === id)?.delegated, rows: Object.fromEntries((sc.data || []).filter((x) => x.team_id === id).map((x) => [x.day, x.slots])) };
  }
  const slotsOf = (T0, iso) => (T0.delegated || !T0.rows[iso] ? trnAuto(iso, races) : T0.rows[iso]);                    // jour non rempli : planning du directeur sportif
  const dayLoad = (T0, iso) => { const L = locked[iso]; if (L) return L.type === 'RACE' ? 0.8 : 0.1; const s = slotsOf(T0, iso); return TE_W.reduce((a, w, i) => a + w * (TE_LOAD[i][s[i] || 'Repos'] || 0), 0); };
  const weekly = (T0, iso) => ([...Array(7)].reduce((a, _, i) => a + dayLoad(T0, trnAdd(iso, -i)), 0) / 7 / 0.85) * 100;   // charge hebdomadaire en % (planning type ≈ 60 %)
  const ip = Object.fromEntries((it.data || []).map((x) => [x.rider_id, x])), FIELDS = ['fatigue', 'fitness', 'injured_until', 'injury_type', 'training_progress', ...TE_COLS];
  const R = Object.fromEntries((rs.data || []).map((r) => [r.id, { ...r }])), snap = Object.fromEntries((rs.data || []).map((r) => [r.id, JSON.stringify(FIELDS.map((f) => r[f]))]));
  const sum = { gains: 0, injuries: 0, healed: 0, over: 0, under: 0, language: 0 };

  for (let d = 0; d < daysPassed; d++) {
    const iso = trnAdd(startIso, d), last = d === daysPassed - 1;
    for (const r of Object.values(R)) {
      const owner = ownerOf(r.team_id), T0 = T[owner]; if (!T0) continue;
      const plan = ip[r.id] || { focus: 'ALL', intensity: 'NORMAL', rehab: false, coach: null }, mult = TE_MULT[plan.intensity] ?? 1, injured = !!(r.injured_until && r.injured_until > iso);
      const rehab = injured && plan.rehab && T0.medical > 0, bonus = itBonus(T0.members.find((m) => m.key === plan.coach)), imp = calculateStaffImpact(owner, r, T0.ctx);
      const W = injured ? (rehab ? 35 : 0) : Math.min(130, weekly(T0, iso) * mult), dayL = injured ? (rehab ? 0.35 : 0) : Math.min(1.2, dayLoad(T0, iso) * mult);
      // 1. Fatigue : charge du jour (+25 % en sur-entraînement) moins récupération (stat Récupération, staff, repos forcé) ; barrière de langue : +10 % de fatigue
      const fat = teClamp((r.fatigue || 0) + dayL * 14 * imp.fatigueMult * (W > 85 ? 1.25 : 1) - (4 + (r.recovery || 50) / 20) * imp.recoveryMult * (plan.intensity === 'REST' ? 1.4 : 1), 0, 100);
      // 2. Forme physique de course selon la charge hebdomadaire
      const f0 = Number(r.fitness ?? 70); let df;
      if (injured) df = rehab ? 0.3 : -1.0;                                  // blessé sans rééducation supervisée : perte de forme
      else if (W < 40) df = -0.8 * (1 + (40 - W) / 40);                      // sous-entraînement : la forme régresse
      else if (W < 50) df = -0.2;
      else if (W <= 80) df = (75 - f0) * 0.08;                               // équilibre : maintien de la forme
      else if (W <= 85) df = 0.1;
      else df = 0.3 - Math.max(0, fat - 70) * 0.05;                          // sur-entraînement : gain court terme, usure
      if (fat > 80) df -= 0.4;
      r.fatigue = fat; r.fitness = teClamp(f0 + df, 0, 100);
      // 3. Progression des attributs (jamais pour un blessé) : focus individuel + exercices du planning, âge, charge, langue, staff référent, détection des jeunes
      if (!injured) {
        const w = {}; (IT_ATTRS[plan.focus] || []).forEach((a) => (w[a] = (w[a] || 0) + 1));
        if (!locked[iso]) slotsOf(T0, iso).forEach((ex) => (TE_EX_ATTRS[ex] || []).forEach((a) => (w[a] = (w[a] || 0) + 0.5)));
        const ageF = r.age <= 22 ? 1 : r.age <= 26 ? 0.6 : r.age <= 30 ? 0.3 : 0.05, loadF = W < 40 ? 0.2 : W < 50 ? 0.6 : W <= 80 ? 1 : W <= 85 ? 1.15 : 1.4;
        const k = 0.012 * ageF * loadF * imp.progressMult * (1 + bonus * 0.3), cap = r.potential != null ? Math.min(85, Math.round(62 + Number(r.potential) * 4.6)) : 80, prog = { ...(r.training_progress || {}) };
        for (const [code, wt] of Object.entries(w)) {
          const col = code.toLowerCase(); if (r[col] == null) continue;
          prog[col] = (prog[col] || 0) + k * wt;
          while (prog[col] >= 1 && r[col] < cap) { r[col] += 1; prog[col] -= 1; sum.gains++; }
          if (r[col] >= cap) prog[col] = 0;
        }
        r.training_progress = prog;
        // 4. Risque de blessure (+25 % en sur-entraînement)
        if (!locked[iso] && Math.random() < 0.002 * (1 + fat / 100) * (W > 85 ? 1.25 : 1) * (fat > 70 ? 1.5 : 1) * (plan.intensity === 'DOUBLE' ? 1.3 : 1)) {
          r.injured_until = trnAdd(iso, 7 + Math.floor(Math.random() * 28)); r.injury_type = "Blessure à l'entraînement"; sum.injuries++;
        }
      } else {                                                               // convalescence : la rééducation supervisée double la vitesse de guérison
        const until = rehab ? trnAdd(r.injured_until, -1) : r.injured_until;
        if (until <= trnAdd(iso, 1)) { r.injured_until = null; r.injury_type = null; sum.healed++; } else r.injured_until = until;
      }
      if (last) { if (W > 85) sum.over++; if (!injured && W < 40) sum.under++; if (imp.language.penalized) sum.language++; }
    }
  }
  const patches = Object.values(R).filter((r) => JSON.stringify(FIELDS.map((f) => r[f])) !== snap[r.id]).map((r) => {
    const p = Object.fromEntries(FIELDS.map((f) => [f, r[f]])); p.fatigue = Math.round(p.fatigue); p.fitness = Math.round(p.fitness * 10) / 10;
    if (TE_COLS.some((c) => r[c] !== (rs.data.find((x) => x.id === r.id) || {})[c])) Object.assign(p, legacyStats(r));
    return { id: r.id, p };
  });
  for (let i = 0; i < patches.length; i += 15) await Promise.all(patches.slice(i, i + 15).map((x) => sb.from('riders').update(x.p).eq('id', x.id)));
  return { ...sum, riders: patches.length };
}
/* ===== Graphique en toile d'araignée et comparaison de coureurs ===== */
const RADAR_AX = ['GC', 'MTN', 'TTR', 'SPR', 'HIL', 'COB', 'BAR'];
const RADAR_ATTRS = ['MTN', 'MM', 'HIL', 'DHI', 'ATT', 'TTR', 'PRL', 'FLA', 'COB', 'SPR', 'ACC', 'STA', 'RES', 'REC'];
function radarVals(r) {
  const A = attrsOf(r), v = (k) => Number(A[k]) || 50;
  return { GC: (v('MTN') + v('TTR') + v('RES')) / 3, MTN: v('MTN'), TTR: v('TTR'), SPR: v('SPR'), HIL: v('HIL'), COB: v('COB'), BAR: (v('FLA') + v('ATT')) / 2 };
}
function radarSVG(list) {   // list : [{ r: coureur, color }], échelle de 40 à 90
  const cx = 120, cy = 112, R = 72, n = RADAR_AX.length, ang = (i) => ((-90 + (i * 360) / n) * Math.PI) / 180;
  const pt = (i, f) => `${(cx + Math.cos(ang(i)) * R * f).toFixed(1)},${(cy + Math.sin(ang(i)) * R * f).toFixed(1)}`;
  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${RADAR_AX.map((_, i) => pt(i, f)).join(' ')}" fill="none" stroke="#475569" stroke-width="1" opacity=".7"/>`).join('');
  const spokes = RADAR_AX.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1).split(',')[0]}" y2="${pt(i, 1).split(',')[1]}" stroke="#475569" opacity=".5"/>`).join('');
  const labels = RADAR_AX.map((k, i) => `<text x="${(cx + Math.cos(ang(i)) * (R + 16)).toFixed(1)}" y="${(cy + Math.sin(ang(i)) * (R + 16) + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#cbd5e1">${k}</text>`).join('');
  const polys = list.map(({ r, color }) => { const v = radarVals(r); return `<polygon points="${RADAR_AX.map((k, i) => pt(i, Math.max(0.03, Math.min(1, (v[k] - 40) / 50)))).join(' ')}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="2.2"/>`; }).join('');
  return `<svg viewBox="0 0 240 224" style="width:100%;max-width:300px;display:block;margin:.4rem auto">${rings}${spokes}${polys}${labels}</svg>`;
}
const riderRadarHTML = (r) => `<div class="muted" style="margin-top:.6rem">Profil du coureur</div>${radarSVG([{ r, color: '#facc15' }])}`;

async function openRiderCompare(id) {
  const { data: base } = await sb.from('riders').select('*').eq('id', id).maybeSingle();
  if (!base) return toast('Coureur introuvable.');
  const ov = document.createElement('div'); ov.className = 'adm-ov'; ov.id = 'cmp-modal';
  ov.innerHTML = `<div class="adm-box" style="max-width:640px"><div class="neg-head"><h3 style="margin:0">Comparer ${esc(base.first_name)} ${esc(base.last_name)}</h3><button class="link" id="cmp-x">Fermer</button></div>
    <input id="cmp-q" placeholder="Rechercher un coureur à comparer" style="width:100%"><div id="cmp-list" class="cmp-list"></div><div id="cmp-res"></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove(); $('cmp-x').onclick = close; ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let all = null, tn = {};
  const search = async () => {
    const box = $('cmp-list'); if (!box) return;
    if (!all) {
      box.innerHTML = '<p class="muted" style="padding:.5rem">Chargement des coureurs…</p>';
      const t = await sb.from('teams').select('id, name, official_name'); tn = Object.fromEntries((t.data || []).map((x) => [x.id, x.official_name || x.name]));
      const rows = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await sb.from('riders').select('id, first_name, last_name, age, team_id').order('id').range(from, from + 999);
        if (error) { box.innerHTML = `<p class="err" style="padding:.5rem">${esc(error.message)}</p>`; return; }
        rows.push(...(data || [])); if (!data || data.length < 1000) break;
      }
      all = rows;
    }
    const words = norm($('cmp-q').value).split(/\s+/).filter(Boolean), mineSet = new Set(myTeamIds());
    let list = all.filter((x) => x.id !== id && words.every((w) => norm(x.first_name + ' ' + x.last_name).includes(w)));
    if (!words.length) list = list.filter((x) => mineSet.has(x.team_id));
    list.sort((a, b) => a.last_name.localeCompare(b.last_name, 'fr'));
    box.innerHTML = list.slice(0, 40).map((x) => `<div class="cmp-it" data-cmpid="${x.id}"><b>${esc(x.first_name)} ${esc(x.last_name)}</b><span class="muted">${x.age} ans · ${esc(tn[x.team_id] || 'Libre')}</span></div>`).join('') || '<p class="muted" style="padding:.5rem">Aucun coureur trouvé.</p>';
  };
  $('cmp-q').oninput = search;
  $('cmp-list').onclick = async (e) => {
    const it = e.target.closest('[data-cmpid]'); if (!it) return;
    const { data: o } = await sb.from('riders').select('*').eq('id', it.dataset.cmpid).maybeSingle(); if (!o) return;
    const A = attrsOf(base), B = attrsOf(o), nm = (r) => `${esc(r.first_name)} ${esc(r.last_name)}`;
    $('cmp-res').innerHTML = `<div style="display:flex;gap:1rem;justify-content:center;font-size:.85rem"><span style="color:#facc15">● ${nm(base)}</span><span style="color:#60a5fa">● ${nm(o)}</span></div>
      ${radarSVG([{ r: base, color: '#facc15' }, { r: o, color: '#60a5fa' }])}
      <div class="tbl"><table class="fm sq"><thead><tr><th>Note</th><th style="color:#facc15">${esc(base.last_name)}</th><th style="color:#60a5fa">${esc(o.last_name)}</th><th>Écart</th></tr></thead><tbody>
      ${RADAR_ATTRS.map((k) => { const a = Number(A[k]) || 0, b = Number(B[k]) || 0, d = a - b; return `<tr><td><b>${k}</b></td><td>${a}</td><td>${b}</td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).join('')}</tbody></table></div>`;
  };
  search();
}
if (!window.cmpBound) {
  window.cmpBound = true;
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-compare]'); if (b) openRiderCompare(b.dataset.compare); });
}
// ---------- Démarrage ----------
(async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ?? null;
  await route();
  sb.auth.onAuthStateChange(async (_e, s) => {
    const u = s?.user ?? null;
    if (u?.id !== state.user?.id) { state.user = u; await route(); }
  });
})();
