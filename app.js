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
Object.assign(state, { menu: 'portal', tab: 'portal', hist: [['portal', 'portal']], hpos: 0, game: null, nextRace: null, mfilter: 'all', q: '', devTeam: null });
const myTeamIds = () => [state.team?.id, state.devTeam?.id].filter(Boolean);
const PROFILES = { FLAT: 'Plat', MOUNTAIN: 'Montagne', HILLS: 'Vallonné', COBBLES: 'Pavés', TIME_TRIAL: 'Contre-la-montre' };
const DAYS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const MENUS = {
  portal: { label: 'PORTAIL', subs: [['portal', 'Portail'], ['overview', "Vue d'ensemble"], ['messages', 'Messages'], ['calendar', 'Calendrier'], ['info', 'Infos'], ['data', 'Centre des données'], ['competitions', 'Compétitions'], ['career', 'Carrière']] },
  squad: { label: 'EFFECTIF', subs: [['squad', "Vue d'ensemble"], ['squad_pro', 'Équipe Pro'], ['squad_u23', 'Équipe Développement (U23)'], ['group', 'Dynamique de groupe'], ['health', 'Santé & Blessures'], ['trainrep', "Rapports d'entraînement"]] },
  recruit: { label: 'RECRUTEMENT', subs: [['overview', "Vue d'ensemble"], ['search', 'Base de données cyclistes'], ['recs', 'Recommandations'], ['missions', 'Recherches ciblées'], ['recruiters', 'Staff de recrutement'], ['market', 'Marché des transferts & accords'], ['watch', 'Liste de sélection']] },  training: { label: 'ENTRAÎNEMENT', subs: [['training', 'Planning']] },
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
    toast(o.error ? 'Jour suivant (observations : ' + o.error.message + ')' : 'Jour suivant.');
  } else toast("Seul l'administrateur fait avancer le temps : date synchronisée.");
  await loadGame(); viewGame();
}

function viewGame() {
  const t = state.team, g = state.game, d = gd(g.game_date);
  const subs = [...MENUS[state.menu].subs]; if (state.menu === 'club' && state.isAdmin) subs.push(['admin', 'Admin']);
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
      ${kv('Division', wt ? 'WorldTour' : 'Continental Pro')}${kv('Réputation du club', wt ? 'Mondiale' : 'Nationale')}${kv('Points UCI', t.uci_points)}${kv('Effectif', pro.length + ' coureurs')}
      <div class="muted" style="margin-top:.5rem">Classement UCI</div>${near.map((x) => `<div class="stat-row ${x.id === t.id ? 'up' : ''}"><span>${ranks.indexOf(x) + 1}. ${esc(x.official_name || x.name)}</span><b>${x.uci_points} pts</b></div>`).join('')}</div>
    <div class="panel"><h4>Vision du club</h4><div class="muted">Objectifs du board (${objectives.length})</div>
      ${objectives.map((o) => `<div class="stat-row"><div>${o.l}<small>${o.h} · ${o.p}</small></div><span class="bd ${o.ok ? 'green' : 'amber'}">${o.ok ? 'Atteint' : 'En cours'}</span></div>`).join('')}</div>
    <div class="panel"><h4>Retours du board</h4><div class="big ${sat >= 50 ? 'up' : 'down'}">${sat >= 75 ? 'Très satisfait' : sat >= 50 ? 'Satisfait' : sat >= 25 ? 'Préoccupé' : 'Mécontent'}</div><div class="muted">${met} objectif(s) sur ${objectives.length} atteint(s)</div><div class="meter"><i style="width:${sat}%"></i></div>
      ${kv('Santé financière', balance >= 0 ? 'Saine' : 'Déficitaire', balance >= 0 ? 'up' : 'down')}${kv('Sponsors signés', (sp.data || []).length)}</div>
    <div class="panel"><h4>Finances</h4><div class="muted">Trésorerie globale</div><div class="big">${fmtEUR(state.team.budget)}</div>
      ${kv('Revenus sponsors / mois', fmtEUR(income))}${kv('Dépenses / mois', fmtEUR(expenses))}${kv('Solde mensuel', fmtEUR(balance), balance >= 0 ? 'up' : 'down')}
      <div class="muted" style="margin-top:.5rem">Masse salariale des coureurs : ${fmtEUR(payroll)} (${pct} % des revenus)</div><div class="meter"><i style="width:${pct}%"></i></div></div>
    <div class="panel"><h4>Staff</h4>${sRows.map(([l, n, max]) => `<div class="stat-row"><div>${l}<small>${n >= max ? 'Complet' : max - n + ' poste(s) vacant(s)'}</small></div><b>${n} / ${max}</b></div>`).join('')}
      ${kv('Coût du staff / mois', fmtEUR(staffCost))}<div class="rov-btns"><button data-cgo="recruit|recruiters">Staff de recrutement</button></div></div>
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
    if (a) { const [act, key] = a.dataset.sact.split('|'); 
    if (act === 'fire') return fireStaff(key);
      if (act === 'hire') return hireStaff(key); state.sid = key; return go('club', 'staff_detail'); }
      if (act === 'offer') return openStaffOffer(key);
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
  const rep = ['Locale', 'Nationale', 'Continentale', 'Internationale', 'Légende du peloton'][rating < 55 ? 0 : rating < 65 ? 1 : rating < 75 ? 2 : rating < 85 ? 3 : 4];
  const tone = (v) => (v >= 80 ? 'g4' : v >= 65 ? 'g3' : v >= 50 ? 'g2' : 'g1'), row = ([k, l]) => `<div class="arow"><span>${l}</span><span class="an ${tone(A[k])}">${A[k]}</span></div>`;
  const kv = (l, v) => `<div class="stat-row"><span>${l}</span><b>${v}</b></div>;`.replace(';', '');
  const career = [...(x.career || []).map((h) => `${h.year} : ${esc(h.role)} · ${esc(h.team)}`), ...(tm ? [`Actuellement : ${esc(STAFF_LABEL[role] || role)} · ${esc(tm.official_name || tm.name)}`] : [])];
  const initials = esc(x.name.split(' ').map((s) => s[0]).slice(0, 2).join(''));
  c.innerHTML = staffNavHTML('staff_all') + `<div class="rhead"><div class="rav">${initials}</div>
    <div class="rid"><div class="rname">${esc(x.name)}</div><div class="muted">${esc(STAFF_LABEL[role] || role)} · ${nat ? flag(nat) : ''}${x.age ? ' · ' + x.age + ' ans' : ''}</div>
      <div class="actmenu"><button type="button" class="actbtn" id="sabtn">Actions <span class="chev">&#9662;</span></button><div class="actlist" id="salist" hidden>
        <button type="button" class="actitem" data-sact="offer|${key}" ${own ? 'disabled' : ''}>Proposer un contrat</button>
        <button type="button" class="actitem" data-sact="fire|${key}" ${own ? '' : 'disabled'}>Résilier le contrat</button><hr>
        <button type="button" class="actitem" data-snav="staff_all">Retour à la liste</button></div></div></div>
    <div class="rteam"><img src="${esc(logoSrc(tm || { name: '?' }))}" alt=""><div><b>${esc(tm ? tm.official_name || tm.name : 'Sans contrat')}</b><div class="muted">Équipe actuelle</div></div></div>
    <div class="rbox"><div class="muted">Contrat</div><b>${fmtEUR(x.monthly_salary || 0)} / mois</b><div class="muted">Fin : ${x.contract_end_year ? '31/12/' + x.contract_end_year : '-'}</div></div>
    <div class="rbox"><div class="muted">Réputation</div><b>${rep}</b></div></div>
    <div class="rcols"><div class="panel"><h4>Attributs techniques / métier</h4>${STAFF_ATTR_KEYS.slice(0, 5).map(row).join('')}</div>
      <div class="panel"><h4>Attributs mentaux</h4>${STAFF_ATTR_KEYS.slice(5).map(row).join('')}</div>
      <div class="panel"><h4>Infos</h4>${kv('Rôle préféré', esc(STAFF_LABEL[role] || role))}${kv('Réputation', rep)}${kv('Évaluation globale', rating + ' / 100')}${kv('Type de contrat', esc(x.contract_type || 'Plein temps'))}
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

async function openStaffOffer(key) {
  const [src, id] = key.split(':'), tid = state.team.id;
  const { data: x } = await sb.from(src === 'scout' ? 'scouts' : 'staff').select('*').eq('id', id).maybeSingle();
  if (!x) return toast('Membre du staff introuvable.');
  const sc = src === 'scout', role = sc ? 'SCOUT' : STAFF_ALIAS[x.role] || x.role, demand = Number(x.monthly_salary || 0), free = !x.team_id;
  const [a, b] = await Promise.all([sb.from('staff').select('id', { count: 'exact', head: true }).eq('team_id', tid), sb.from('scouts').select('id', { count: 'exact', head: true }).eq('team_id', tid)]);
  const used = (a.count || 0) + (b.count || 0), cap = [28, 19, 11][staffDiv()], roles = Object.keys(STAFF_LABEL).filter((k) => k !== 'SCOUT');
  const ov = document.createElement('div'); ov.className = 'adm-ov'; ov.id = 'so-modal';
  ov.innerHTML = `<div class="adm-box" style="max-width:560px"><div class="neg-head"><h3 style="margin:0">Proposer un contrat : ${esc(x.name)}</h3><button class="link" id="so-x">Fermer</button></div>
    <div class="muted">${free ? 'Sans contrat : embauche directe' : 'Sous contrat : l\'offre sera envoyée à son club'} · exigence salariale : ${fmtEUR(demand)} / mois · effectif du staff : ${used} / ${cap}</div>
    <div class="adm-grid" style="margin-top:.8rem"><div><label>Rôle proposé</label>${sc ? '<select id="so-role" disabled><option>Scout / Éclaireur</option></select>' : selHtml('so-role', roles.map((k) => [k, STAFF_LABEL[k]]), role)}</div>
      <div><label>Salaire mensuel (€)</label><input id="so-salary" type="number" min="0" step="100" value="${demand}" ${sc ? 'disabled' : ''}></div>
      <div><label>Durée du contrat</label>${selHtml('so-years', [[1, '1 an'], [2, '2 ans'], [3, '3 ans']], 2)}</div></div>
    ${sc ? '<p class="muted">Les recruteurs sont embauchés aux conditions affichées.</p>' : ''}
    <div class="neg-hint" id="so-err" style="color:#f87171"></div><div class="neg-actions"><button class="link" id="so-x2">Annuler</button><button id="so-send">${free ? 'Embaucher' : 'Envoyer l\'offre'}</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove(); $('so-x').onclick = $('so-x2').onclick = close; ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('so-send').onclick = async () => {
    const salary = +$('so-salary').value, years = +$('so-years').value, r = $('so-role').value, err = (m) => { $('so-err').textContent = m; };
    if (!sc && !(salary > 0)) return err('Proposez un salaire mensuel.');
    if (free && !sc && salary < demand * 0.9) return err(`Salaire trop bas : ce candidat exige au moins ${fmtEUR(Math.ceil(demand * 0.9))} / mois.`);
    if (free && used >= cap) return err('Effectif du staff complet.');
    $('so-send').disabled = true;
    let res;
    if (sc) res = await sb.rpc('hire_scout', { p_scout: id });
    else if (free) res = await sb.rpc('hire_staff_contract', { p_staff: id, p_role: r, p_salary: salary, p_years: years });
    else res = await sb.from('staff_offers').insert({ staff_id: id, from_team_id: tid, to_team_id: x.team_id, role: r, monthly_salary: salary, years, status: 'PENDING' });
    if (res.error) { $('so-send').disabled = false; return err(res.error.message); }
    toast(free ? `${x.name} rejoint votre staff.` : 'Offre envoyée au club de ce membre du staff.'); close();
    state.tab === 'staff_detail' ? renderStaffDetail($('content'), key) : renderTab();
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
