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
  club: { label: 'CLUB', subs: [['infra', 'Infrastructures'], ['staff', 'Staff'], ['ranking', 'Classement UCI']] },
};
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
        <nav class="fm-sub">${subs.map(([k, l]) => `<button data-sub="${k}" class="${k === state.tab ? 'on' : ''}">${l}</button>`).join('')}</nav>
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
