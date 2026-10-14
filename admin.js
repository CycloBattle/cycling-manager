// admin.js — Admin : import des coureurs, logos, édition des coureurs et des pays (réservé à l'admin)
// Utilise sb, state, esc, fmtEUR, toast, $, NATS, logoSrc (app.js)

/* ---------- Pays : résolution souple (nom complet, code, variantes) ---------- */
const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const COUNTRY_ALIASES = { 'republique tcheque': 'CZ', czechia: 'CZ', slovakia: 'SK', 'etats unis': 'US', usa: 'US', 'etats unis d amerique': 'US',
  angleterre: 'GB', ecosse: 'GB', 'pays de galles': 'GB', 'grande bretagne': 'GB', uk: 'GB', hollande: 'NL', coree: 'KR', 'republique d irlande': 'IE',
  bielorussie: 'BY', macedoine: 'MK', 'emirats arabes unis': 'AE', 'cote d ivoire': 'CI', 'afrique du sud': 'ZA' };

// Référence intégrée (code:nom:continent ; E=Europe A=Amérique S=Asie O=Océanie F=Afrique) : un pays absent de la table y est retrouvé et ajouté avec le bon code
const COUNTRY_REF = ('AL:Albanie:E,DE:Allemagne:E,AD:Andorre:E,AT:Autriche:E,BE:Belgique:E,BY:Biélorussie:E,BA:Bosnie-Herzégovine:E,BG:Bulgarie:E,HR:Croatie:E,CY:Chypre:E,CZ:Tchéquie:E,DK:Danemark:E,ES:Espagne:E,'
  + 'EE:Estonie:E,FI:Finlande:E,FR:France:E,GR:Grèce:E,HU:Hongrie:E,IS:Islande:E,IE:Irlande:E,IT:Italie:E,LV:Lettonie:E,LI:Liechtenstein:E,LT:Lituanie:E,LU:Luxembourg:E,MT:Malte:E,MD:Moldavie:E,'
  + 'MC:Monaco:E,ME:Monténégro:E,MK:Macédoine du Nord:E,NO:Norvège:E,NL:Pays-Bas:E,PL:Pologne:E,PT:Portugal:E,RO:Roumanie:E,GB:Royaume-Uni:E,RU:Russie:E,SM:Saint-Marin:E,RS:Serbie:E,SK:Slovaquie:E,'
  + 'SI:Slovénie:E,SE:Suède:E,CH:Suisse:E,UA:Ukraine:E,TR:Turquie:E,AR:Argentine:A,BO:Bolivie:A,BR:Brésil:A,CA:Canada:A,CL:Chili:A,CO:Colombie:A,CR:Costa Rica:A,CU:Cuba:A,EC:Équateur:A,US:États-Unis:A,'
  + 'GT:Guatemala:A,MX:Mexique:A,PA:Panama:A,PY:Paraguay:A,PE:Pérou:A,UY:Uruguay:A,VE:Venezuela:A,DO:République dominicaine:A,CN:Chine:S,JP:Japon:S,KR:Corée du Sud:S,IN:Inde:S,IR:Iran:S,IL:Israël:S,'
  + 'KZ:Kazakhstan:S,UZ:Ouzbékistan:S,TH:Thaïlande:S,MY:Malaisie:S,ID:Indonésie:S,PH:Philippines:S,HK:Hong Kong:S,TW:Taïwan:S,QA:Qatar:S,AE:Émirats arabes unis:S,BH:Bahreïn:S,SA:Arabie saoudite:S,'
  + 'SG:Singapour:S,VN:Vietnam:S,MN:Mongolie:S,GE:Géorgie:S,AM:Arménie:S,AZ:Azerbaïdjan:S,AU:Australie:O,NZ:Nouvelle-Zélande:O,ZA:Afrique du Sud:F,DZ:Algérie:F,MA:Maroc:F,TN:Tunisie:F,EG:Égypte:F,'
  + "ER:Érythrée:F,ET:Éthiopie:F,RW:Rwanda:F,KE:Kenya:F,NA:Namibie:F,NG:Nigeria:F,SN:Sénégal:F,CM:Cameroun:F,CI:Côte d'Ivoire:F,MU:Maurice:F").split(',').map((x) => {
  const [code, name_fr, r] = x.split(':'); return { code, name_fr, region: { E: 'Europe', A: 'Amérique', S: 'Asie', O: 'Océanie', F: 'Afrique' }[r] };
});

// Code unique à partir des lettres du nom (dernier recours, pour un pays totalement inconnu)
function makeCode(name, taken) {
  const L = normName(name).replace(/ /g, '').toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(3, 'X'), tries = [L[0] + L[1], L[0] + L[2], L[1] + L[2], L.slice(0, 3)];
  for (let i = 3; i < L.length; i++) tries.push(L[0] + L[i]);
  const t = tries.find((x) => !taken.has(x));
  if (t) return t;
  let n = 1; while (taken.has('X' + n)) n++; return 'X' + n;
}
// Ne bloque jamais : nom complet, code ou variante ; un pays absent de la table est ajouté à la volée (continent « Autre » s'il est inconnu partout)
function makeResolver(table) {
  const byName = new Map(), codes = new Set(table.map((c) => c.code)), created = [];
  COUNTRY_REF.forEach((c) => byName.set(normName(c.name_fr), c));
  table.forEach((c) => byName.set(normName(c.name_fr), c));                         // la table prime (noms éventuellement renommés)
  const use = (c) => { if (!codes.has(c.code)) { created.push({ code: c.code, name_fr: c.name_fr, region: c.region }); codes.add(c.code); } return c.code; };
  const resolve = (raw) => {
    const n = normName(raw), up = String(raw).trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(up)) { if (codes.has(up)) return up; const ref = COUNTRY_REF.find((c) => c.code === up); if (ref) return use(ref); }
    if (byName.has(n)) return use(byName.get(n));
    const al = COUNTRY_ALIASES[n];
    if (al) { const ref = COUNTRY_REF.find((c) => c.code === al); return ref ? use(ref) : al; }
    const c = { code: makeCode(raw, codes), name_fr: String(raw).trim(), region: 'Autre' }; byName.set(n, c); return use(c);
  };
  return { resolve, created };
}

/* ---------- Import des coureurs ---------- */
// Format : Nom;Date de naissance (jj.mm.aaaa);Âge;Pays;Équipe;14 attributs (MTN,MM,HIL,DHI,ATT,TTR,PRL,FLA,COB,SPR,ACC,STA,RES,REC);Potentiel (x/6);Salaire mensuel;Clause
function parseRiders(text, resolve) {
  const rows = [], errors = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    if (/^nom\s*;/i.test(line)) return;
    const f = line.split(';').map((x) => x.trim());
    if (f.length < 9) return errors.push(`Ligne ${i + 1} : ${f.length} champs au lieu de 9`);
    const a = f[5].split(',').map(Number);
    if (a.length !== 14 || a.some((x) => !Number.isFinite(x))) return errors.push(`Ligne ${i + 1} : 14 attributs attendus (${f[0]})`);
    const [d, m, y] = f[1].split('.'), parts = f[0].split(' '), pm = f[6].match(/([\d.,]+)\s*\/\s*([\d.,]+)/), num = (s) => parseFloat(String(s).replace(',', '.'));
    rows.push({ first: parts[0], last: parts.slice(1).join(' '), birth: `${y}-${m}-${d}`, age: +f[2], code: resolve(f[3]), team: f[4], a,
      pot: pm ? Math.round((num(pm[1]) / num(pm[2])) * 50) / 10 : null, salary: Number(f[7].replace(/\s/g, '')) || 0, clause: Number(f[8].replace(/\s/g, '')) || 0 });
  });
  return { rows, errors };
}

// Les 8 notes utilisées par le moteur de course sont déduites des 14 attributs
const legacyStats = (a) => ({ flat: a.fla, mountain: a.mtn, hills: Math.round((a.mm + a.hil) / 2), time_trial: a.ttr, sprint: a.spr, cobbles: a.cob, stamina: a.sta, recovery: a.rec });

async function importRiders(rows, wipe, newCountries) {
  const season = state.game.season_year;
  if (newCountries.length) {
    const { error } = await sb.from('countries').upsert(newCountries, { onConflict: 'code' });
    if (error) throw new Error('Pays : ' + error.message + ' (lancez le script 017 dans Supabase)');
    newCountries.forEach((c) => (NATS[c.code] = c.name_fr));
  }
  if (wipe) { const { error } = await sb.from('riders').delete().not('id', 'is', null); if (error) throw error; }
  const { data: existing } = await sb.from('teams').select('id, name');
  const teamId = Object.fromEntries((existing || []).map((t) => [t.name, t.id]));
  for (const name of [...new Set(rows.map((r) => r.team))]) {
    if (teamId[name]) continue;
    const cnt = {}; rows.filter((r) => r.team === name).forEach((r) => (cnt[r.code] = (cnt[r.code] || 0) + 1));
    const nat = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0][0], dev = /dev(elopment)? team/i.test(name);
    const { data, error } = await sb.from('teams').insert({ name, nationality: nat, category: dev ? 'DEV' : 'WORLD_TOUR', division: dev ? 'CONTI_PRO' : 'WORLD_TOUR', budget: 50000 }).select().single();
    if (error) throw error;
    teamId[name] = data.id;
  }
  const recs = rows.map((r, i) => { const a = r.a, o = { mtn: a[0], mm: a[1], hil: a[2], dhi: a[3], att: a[4], ttr: a[5], prl: a[6], fla: a[7], cob: a[8], spr: a[9], acc: a[10], sta: a[11], res: a[12], rec: a[13] };
    return { team_id: teamId[r.team], first_name: r.first, last_name: r.last, nationality: r.code, age: r.age, birth_date: r.birth, ...o, ...legacyStats(o),
      potential: r.pot, contract_salary: r.salary, release_clause: r.clause, contract_end_year: season + 1 + (i % 3), fatigue: 0 }; });
  for (let i = 0; i < recs.length; i += 40) { const { error } = await sb.from('riders').insert(recs.slice(i, i + 40)); if (error) throw error; }
  const base = (n) => n.replace(/\s+(Dev(elopment)? Team|Team|WT)$/i, ''), names = Object.keys(teamId), isDev = (n) => /dev(elopment)? team/i.test(n);
  for (const n of names.filter(isDev)) {   // rattache chaque Dev Team à son équipe pro
    const p = names.find((x) => !isDev(x) && base(x) === base(n));
    if (p) await sb.from('teams').update({ parent_team_id: teamId[p] }).eq('id', teamId[n]);
  }
  return Object.keys(teamId).length;
}

/* ---------- Logos ---------- */
async function renderLogos() {
  const box = $('logos'); if (!box) return;
  const { data } = await sb.from('teams').select('id, name, logo_url, category').order('name');
  box.innerHTML = '<h4>Logos des équipes</h4><p class="muted">PNG, JPG ou WebP, de préférence carré (1 Mo maximum).</p>' + (data || []).map((t) =>
    `<div class="logorow"><img class="tlogo" src="${esc(logoSrc(t))}" alt=""><div style="flex:1">${esc(t.name)} <span class="muted">${t.category === 'DEV' ? 'Dev Team' : 'WorldTour'}</span></div><input type="file" accept="image/png,image/jpeg,image/webp" data-logo="${t.id}" style="width:auto"></div>`).join('');
  box.onchange = async (e) => {
    const id = e.target.dataset.logo, f = e.target.files?.[0];
    if (!id || !f) return;
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[f.type];
    if (!ext) return toast('Format non accepté (PNG, JPG ou WebP).');
    if (f.size > 1024 * 1024) return toast('Logo trop lourd (1 Mo maximum).');
    const path = `team-${id}.${ext}`;
    const { error } = await sb.storage.from('team-logos').upload(path, f, { upsert: true, contentType: f.type });
    if (error) return toast(error.message);
    const url = sb.storage.from('team-logos').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
    const { error: e2 } = await sb.from('teams').update({ logo_url: url }).eq('id', id);
    if (e2) return toast(e2.message);
    if (state.team.id === id) state.team.logo_url = url;
    toast('Logo enregistré.'); renderLogos();
  };
}

/* ---------- Édition des coureurs ---------- */
const ATTR_COLS = [['mtn', 'MTN'], ['mm', 'MM'], ['hil', 'HIL'], ['dhi', 'DHI'], ['att', 'ATT'], ['ttr', 'TTR'], ['prl', 'PRL'], ['fla', 'FLA'], ['cob', 'COB'], ['spr', 'SPR'], ['acc', 'ACC'], ['sta', 'STA'], ['res', 'RES'], ['rec', 'REC']];
const adm = { riders: [], teams: [], countries: [], q: '', team: 'all' };
const admSel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

async function renderRiderAdmin() {
  const box = $('radm'); if (!box) return;
  box.innerHTML = '<h4>Édition des coureurs</h4><p class="muted">Chargement…</p>';
  const [r, t, c] = await Promise.all([sb.from('riders').select('*').order('last_name'), sb.from('teams').select('id, name').order('name'), sb.from('countries').select('*').order('name_fr')]);
  Object.assign(adm, { riders: r.data || [], teams: t.data || [], countries: c.data || [] });
  box.innerHTML = `<h4>Édition des coureurs</h4><div class="fbar"><input id="ra-q" placeholder="Nom ou prénom" value="${esc(adm.q)}">
    ${admSel('ra-team', [['all', 'Toutes les équipes'], ['none', 'Sans contrat'], ...adm.teams.map((x) => [x.id, x.name])], adm.team)}</div><div id="ra-list"></div>`;
  $('ra-q').oninput = (e) => { adm.q = e.target.value; drawRiderAdmin(); };
  $('ra-team').onchange = (e) => { adm.team = e.target.value; drawRiderAdmin(); };
  box.onclick = (e) => { const b = e.target.closest('[data-edit]'); if (b) openRiderEditor(b.dataset.edit); };
  drawRiderAdmin();
}
function drawRiderAdmin() {
  const q = normName(adm.q), tn = Object.fromEntries(adm.teams.map((t) => [t.id, t.name]));
  const rows = adm.riders.filter((r) => (adm.team === 'all' || (adm.team === 'none' ? !r.team_id : r.team_id === adm.team)) && (!q || normName(r.first_name + ' ' + r.last_name).includes(q)));
  $('ra-list').innerHTML = `<div class="muted">${rows.length} coureur(s)${rows.length > 60 ? ' (60 premiers affichés : affinez la recherche)' : ''}</div><div class="tbl"><table class="fm">
    <tr><th>Coureur</th><th>Âge</th><th>Pays</th><th>Équipe</th><th>Salaire</th><th>Clause</th><th></th></tr>${rows.slice(0, 60).map((r) =>
    `<tr><td>${esc(r.first_name)} ${esc(r.last_name)}</td><td>${r.age}</td><td>${esc(NATS[r.nationality] || r.nationality)}</td><td>${esc(tn[r.team_id] || 'Sans contrat')}</td>
      <td>${fmtEUR(r.contract_salary || 0)}</td><td>${r.release_clause != null ? fmtEUR(r.release_clause) : '-'}</td><td><button data-edit="${r.id}">Éditer</button></td></tr>`).join('')}</table></div>`;
}

function openRiderEditor(id) {
  const r = adm.riders.find((x) => x.id === id); if (!r) return;
  const field = (fid, label, val, type = 'number', extra = '') => `<div><label>${label}</label><input id="${fid}" type="${type}" value="${val ?? ''}" ${extra}></div>`;
  const natOpts = adm.countries.map((c) => [c.code, `${c.name_fr} (${c.code})`]); if (!adm.countries.some((c) => c.code === r.nationality)) natOpts.unshift([r.nationality, r.nationality]);
  const ov = document.createElement('div'); ov.className = 'adm-ov'; ov.id = 'adm-modal';
  ov.innerHTML = `<div class="adm-box"><div class="neg-head"><h3 style="margin:0">Éditer ${esc(r.first_name)} ${esc(r.last_name)}</h3><button class="link" id="ed-x">Fermer</button></div>
    <div class="adm-sec">Identité</div><div class="adm-grid">${field('e-first', 'Prénom', esc(r.first_name), 'text')}${field('e-last', 'Nom', esc(r.last_name), 'text')}
      ${field('e-age', 'Âge', r.age)}${field('e-birth', 'Date de naissance', r.birth_date || '', 'date')}
      <div><label>Pays</label>${admSel('e-nat', natOpts, r.nationality)}</div><div><label>Équipe</label>${admSel('e-team', [['', 'Sans contrat'], ...adm.teams.map((t) => [t.id, t.name])], r.team_id || '')}</div></div>
    <div class="adm-sec">Valeurs et contrat (€)</div><div class="adm-grid">${field('e-mv', 'Valeur marchande', r.market_value, 'number', 'placeholder="calculée"')}
      ${field('e-sal', 'Salaire mensuel', r.contract_salary)}${field('e-clause', 'Clause libératoire', r.release_clause)}${field('e-end', 'Fin de contrat (année)', r.contract_end_year)}
      ${field('e-pot', 'Potentiel (0 à 5 étoiles)', r.potential, 'number', 'step="0.5" min="0" max="5"')}</div>
    <div class="adm-sec">Attributs PCM</div><div class="adm-grid">${ATTR_COLS.map(([k, l]) => field('ea-' + k, l, r[k], 'number', 'min="0" max="100"')).join('')}</div>
    <div class="neg-hint" id="ed-err" style="color:#f87171"></div><div class="neg-actions"><button class="link" id="ed-x2">Annuler</button><button id="ed-save">Enregistrer</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove(); $('ed-x').onclick = $('ed-x2').onclick = close; ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('ed-save').onclick = async () => {
    const num = (i) => { const v = $(i).value; return v === '' ? null : Number(v); }, err = (m) => { $('ed-err').textContent = m; };
    const a = Object.fromEntries(ATTR_COLS.map(([k]) => [k, num('ea-' + k)]));
    const upd = { first_name: $('e-first').value.trim(), last_name: $('e-last').value.trim(), age: num('e-age'), birth_date: $('e-birth').value || null, nationality: $('e-nat').value,
      team_id: $('e-team').value || null, market_value: num('e-mv'), contract_salary: num('e-sal'), release_clause: num('e-clause'), contract_end_year: num('e-end'), potential: num('e-pot'), ...a };
    if (!upd.first_name || !upd.last_name) return err('Le prénom et le nom sont obligatoires.');
    if (!(upd.age >= 15 && upd.age <= 60)) return err('Âge invalide (15 à 60).');
    if (upd.potential != null && (upd.potential < 0 || upd.potential > 5)) return err('Le potentiel va de 0 à 5.');
    if (Object.values(a).some((v) => v != null && (v < 0 || v > 100))) return err('Les attributs vont de 0 à 100.');
    if (ATTR_COLS.every(([k]) => a[k] != null)) Object.assign(upd, legacyStats(a));      // synchronise les notes du moteur de course
    $('ed-save').disabled = true;
    const { error } = await sb.from('riders').update(upd).eq('id', id);
    if (error) { $('ed-save').disabled = false; return err(error.message); }
    Object.assign(r, upd); toast('Coureur enregistré.'); close(); drawRiderAdmin();
  };
}

/* ---------- Édition des pays (noms et continents) ---------- */
async function renderCountryAdmin() {
  const box = $('cadm'); if (!box) return;
  const { data } = await sb.from('countries').select('*').order('name_fr'), list = data || [], regions = [...new Set(list.map((c) => c.region))];
  box.innerHTML = `<details><summary><b class="muted">Pays et continents (${list.length})</b></summary><p class="muted">Un pays ajouté automatiquement à l'import arrive avec le continent « Autre » : corrigez-le ici.</p>
    <datalist id="regions">${regions.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>${list.map((c) => `<div class="logorow"><b style="width:2.5rem">${esc(c.code)}</b>
    <input data-cn="${esc(c.code)}" value="${esc(c.name_fr)}"><input data-cr="${esc(c.code)}" list="regions" value="${esc(c.region)}" style="width:11rem"><button data-csave="${esc(c.code)}">Enregistrer</button></div>`).join('')}</details>`;
  box.onclick = async (e) => {
    const b = e.target.closest('[data-csave]'); if (!b) return;
    const code = b.dataset.csave, name = box.querySelector(`[data-cn="${code}"]`).value.trim(), region = box.querySelector(`[data-cr="${code}"]`).value.trim();
    if (!name || !region) return toast('Nom et continent obligatoires.');
    const { error } = await sb.from('countries').update({ name_fr: name, region }).eq('code', code);
    if (error) return toast(error.message);
    NATS[code] = name; toast('Pays enregistré.');
  };
}

/* ---------- Écran Admin ---------- */
function renderAdmin(c) {
  if (!state.isAdmin) { c.innerHTML = '<div class="panel">Réservé à l\'administrateur.</div>'; return; }
  c.innerHTML = `<div class="panel"><h4>Import des coureurs officiels</h4>
    <p class="muted">Collez vos lignes : <code>Nom;Date de naissance;Âge;Pays;Équipe;14 attributs;Potentiel;Salaire;Clause</code>. La ligne d'en-tête est ignorée. Un pays inconnu est ajouté automatiquement.</p>
    <textarea id="imp" rows="12" placeholder="Maurice Ballerstedt;16.01.2001;25;Allemagne;Alpecin-Premier Tech WT;57,59,65,72,70,66,68,72,68,71,71,67,68,66;3.5/6;500;350000"></textarea>
    <label style="margin-top:.5rem"><input type="checkbox" id="wipe" checked style="width:auto"> Supprimer d'abord tous les coureurs existants (coureurs de test)</label>
    <div class="sq-ctl" style="margin:.6rem 0"><button id="an">Analyser</button><button id="go" disabled>Importer</button></div>
    <pre id="rep" class="muted" style="white-space:pre-wrap"></pre></div>
    <div class="panel" id="radm" style="margin-top:.75rem"></div>
    <div class="panel" id="cadm" style="margin-top:.75rem"></div>
    <div class="panel" id="logos" style="margin-top:.75rem"></div>`;
  renderRiderAdmin(); renderCountryAdmin(); renderLogos();
  let parsed = null;
  $('an').onclick = async () => {
    const { data } = await sb.from('countries').select('*'), R = makeResolver(data || []);
    parsed = parseRiders($('imp').value, R.resolve); parsed.created = R.created;
    const per = {}; parsed.rows.forEach((r) => (per[r.team] = (per[r.team] || 0) + 1));
    $('rep').textContent = `${parsed.rows.length} coureur(s) valides\n` + Object.entries(per).map(([t, n]) => `  ${t} : ${n}`).join('\n')
      + (R.created.length ? `\n\nPays ajoutés automatiquement (${R.created.length}) : ${R.created.map((x) => `${x.name_fr} → ${x.code}`).join(', ')}` : '')
      + (parsed.errors.length ? `\n\nErreurs :\n${parsed.errors.join('\n')}` : '');
    $('go').disabled = !parsed.rows.length || parsed.errors.length > 0;
  };
  $('go').onclick = async () => {
    $('go').disabled = true; $('rep').textContent = 'Import en cours…';
    try { const n = await importRiders(parsed.rows, $('wipe').checked, parsed.created); $('rep').textContent = `Terminé : ${parsed.rows.length} coureurs, ${n} équipes.`; toast('Import terminé.'); renderRiderAdmin(); renderCountryAdmin(); renderLogos(); }
    catch (e) { $('rep').textContent = 'Erreur : ' + (e.message || e); $('go').disabled = false; }
  };
}
