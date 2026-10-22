// recruit.js — Recrutement : base de données (brouillard de guerre), liste de sélection, recruteurs, missions
// Utilise sb, state, esc, fmtEUR, NATS, toast, $, go, gd, myTeamIds (app.js), flag, stars, starV, enrich, SPEC_FILTERS, SPEC_NAMES (squad.js), attrsOf, hashN (rider.js)
const ATTR_CODES = ['MTN', 'MM', 'HIL', 'FLA', 'COB', 'SPR', 'ACC', 'TTR', 'PRL', 'DHI', 'ATT', 'STA', 'RES', 'REC'];
const GRADES = ['F', 'D', 'C', 'B', 'A', 'A+'];
const dbf = { name: '', country: 'all', ageMin: '', ageMax: '', spec: 'all', endMax: '', attr: 'none', attrMin: '', status: 'all', grade: 'all', stars: '', clauseMax: '', sort: { k: 'level', d: -1 } };
const db = { all: [], fq: { ca: 1.2, pa: 1.2 }, avg: 65 };
const mission = { scout: null };

/* ---------- Brouillard de guerre : fourchettes qui se resserrent avec la connaissance ----------
   < 20 % : tout est masqué ; 100 % : valeurs exactes. Les recruteurs précis (CA / PA élevés) réduisent l'incertitude. */
const fogFrac = (id, key) => (hashN(id + key) % 1000) / 1000;                 // position stable de la vraie valeur dans la fourchette
const fogW = (kn, q) => Math.max(0, Math.round(((100 - kn) / 10) * q));
function fogRange(v, id, key, kn, q, min = -Infinity, max = Infinity) {
  const w = fogW(kn, q); if (!w) return [v, v];
  const a = Math.round(fogFrac(id, key) * 2 * w);
  return [Math.max(min, v - a), Math.min(max, v + 2 * w - a)];                // la vraie valeur est toujours dans la fourchette
}
const attrRange = (v, id, code, kn, q) => fogRange(v, id, code, kn, q, 50, 85);
const lvlRange = (r, kn, q) => fogRange(r.level, r.id, 'LVL', kn, q);
function potRange(r, kn, q) {
  const p = starV(r.pot), w = ((100 - kn) / 100) * 1.8 * q; if (!w) return [p, p];
  const a = fogFrac(r.id, 'POT') * 2 * w, h = (x) => Math.round(x * 2) / 2;
  return [Math.max(0, h(p - a)), Math.min(6, h(p + 2 * w - a))];
}
function moneyBounds(v, id, key, kn) { const w = ((100 - kn) / 100) * 0.5, a = fogFrac(id, key) * 2 * w; return [v * (1 - a), v * (1 + 2 * w - a)]; }
const shortEUR = (x) => (x >= 1e6 ? (x / 1e6).toFixed(1).replace('.', ',') + ' M€' : x >= 1000 ? Math.round(x / 1000) + ' k€' : Math.round(x) + ' €');
function moneyFog(v, id, key, kn, own) {
  if (own || kn >= 100) return fmtEUR(v);
  if (kn < 50) return '<span class="muted">?</span>';
  const [lo, hi] = moneyBounds(v, id, key, kn); return `${shortEUR(lo)} à ${shortEUR(hi)}`;
}
const starsRange = (lo, hi) => `<span class="stars range" style="--lo:${lo};--hi:${hi}" title="${String(lo).replace('.', ',')} à ${String(hi).replace('.', ',')} / 6">★★★★★★</span>`;
const scoutFactors = (rows) => { const m = (k) => (rows.length ? Math.max(...rows.map((s) => s[k])) : 6); return { ca: 1.5 - m('judging_current_ability') / 20, pa: 1.5 - m('judging_potential_ability') / 20 }; };
function levelStars(r, kn, own, fq) {
  if (own || kn >= 100) return stars(r.level);
  if (kn < 20) return '<span class="muted">?</span>';
  const [lo, hi] = lvlRange(r, kn, fq.ca); return starsRange(starV(lo), starV(hi));
}
function potStars(r, kn, own, fq) {
  if (own || kn >= 100) return stars(r.pot);
  if (kn < 40) return '<span class="muted">?</span>';
  const [lo, hi] = potRange(r, kn, fq.pa); return starsRange(lo, hi);
}
function gradeOf(est) { const d = est - db.avg; return d >= 8 ? 'A+' : d >= 4 ? 'A' : d >= 0 ? 'B' : d >= -4 ? 'C' : d >= -8 ? 'D' : 'F'; }   // relative au niveau moyen de VOTRE équipe
const gradeBadge = (r) => (r.est == null ? '' : ` <span class="bd ${{ 'A+': 'green', A: 'green', B: 'blue', C: 'amber', D: 'red', F: 'red' }[gradeOf(r.est)]}">${gradeOf(r.est)}</span>`);
const selHtml = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

/* ---------- Chargement ---------- */
async function loadDb() {
  const tid = state.team.id, mine = new Set(myTeamIds());
  const [rs, tm, sc, ob, wl, sk] = await Promise.all([
    sb.from('riders').select('*'),
    sb.from('teams').select('id, name, official_name'),
    sb.from('scouting_reports').select('rider_id, knowledge').eq('team_id', tid),
    sb.from('rider_observations').select('rider_id, observer_team_id'),
    sb.from('watchlist').select('rider_id, notes').eq('team_id', tid),
    sb.from('scouts').select('*').eq('team_id', tid),
  ]);
  const teamName = Object.fromEntries((tm.data || []).map((t) => [t.id, t.official_name || t.name]));
  const know = Object.fromEntries((sc.data || []).map((x) => [x.rider_id, x.knowledge]));
  const obsN = {}, mineObs = new Set();
  (ob.data || []).forEach((o) => { if (o.observer_team_id === tid) mineObs.add(o.rider_id); else obsN[o.rider_id] = (obsN[o.rider_id] || 0) + 1; });
  const notes = Object.fromEntries((wl.data || []).map((x) => [x.rider_id, x.notes || '']));
  db.fq = scoutFactors(sk.data || []);
  const enr = enrich(rs.data || [], state.game.game_date), own = enr.filter((r) => mine.has(r.team_id));
  db.avg = own.length ? own.reduce((s, r) => s + r.level, 0) / own.length : 65;
  db.all = enr.filter((r) => !mine.has(r.team_id)).map((r) => {
    const kn = know[r.id] ?? 0, lr = kn >= 100 ? [r.level, r.level] : kn >= 20 ? lvlRange(r, kn, db.fq.ca) : null;
    return { ...r, team: r.team_id ? teamName[r.team_id] || '-' : 'Sans contrat', kn, obsN: obsN[r.id] || 0, mineObs: mineObs.has(r.id),
      watched: r.id in notes, note: notes[r.id] || '', A: attrsOf(r), lr, est: lr ? (lr[0] + lr[1]) / 2 : null };
  });
}

// Les valeurs masquées ne servent pas au tri ; les valeurs floues sont triées sur le milieu de leur fourchette
function dbVal(r, k) {
  if (k === 'name') return r.last_name;
  if (k === 'team') return r.team;
  if (k === 'nat') return r.nationality;
  if (k === 'level') return r.est ?? -1;
  if (k === 'pot') return r.kn >= 100 ? starV(r.pot) : r.kn >= 40 ? potRange(r, r.kn, db.fq.pa).reduce((a, b) => a + b) / 2 : -1;
  if (k === 'clause' || k === 'salary') {
    if (r.kn < 50) return -1;
    const v = k === 'clause' ? r.clause ?? r.value : r.contract_salary || 0;
    return r.kn >= 100 ? v : moneyBounds(v, r.id, k, r.kn).reduce((a, b) => a + b) / 2;
  }
  if (k === 'end') return r.contract_end_year || 0;
  return r[k] ?? 0;
}
function statusOk(r, s) {
  if (s === 'all') return true;
  if (s === 'free') return !r.team_id;
  if (s === 'signed') return !!r.team_id;
  const lim = gd(state.game.game_date); lim.setMonth(lim.getMonth() + (s === 'exp6' ? 6 : 12));
  return !!r.team_id && !!r.contract_end_year && new Date(r.contract_end_year + '-12-31T12:00:00') <= lim;
}

/* ---------- Base de données cyclistes et liste de sélection ---------- */
async function renderDatabase(c, mode) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  await loadDb();
  const countries = [...new Set(db.all.map((r) => r.nationality))].sort((a, b) => (NATS[a] || a).localeCompare(NATS[b] || b, 'fr'));
  c.innerHTML = `<div class="panel full"><h4>${mode === 'watch' ? 'Liste de sélection' : 'Base de données cyclistes'}</h4>
    <div class="fbar">
      <input id="f-name" placeholder="Nom" value="${esc(dbf.name)}">
      ${selHtml('f-country', [['all', 'Tous les pays'], ...countries.map((x) => [x, NATS[x] || x])], dbf.country)}
      <input id="f-ageMin" type="number" placeholder="Âge min" value="${dbf.ageMin}" style="width:90px"><input id="f-ageMax" type="number" placeholder="Âge max" value="${dbf.ageMax}" style="width:90px">
      ${selHtml('f-spec', Object.entries(SPEC_FILTERS), dbf.spec)}
      ${selHtml('f-status', [['all', 'Tous les statuts'], ['free', 'Sans contrat'], ['exp6', 'Fin de contrat sous 6 mois'], ['exp12', 'Fin de contrat sous 12 mois'], ['signed', 'Sous contrat']], dbf.status)}
      <input id="f-endMax" type="number" placeholder="Fin de contrat ≤ (année)" value="${dbf.endMax}" style="width:170px">
      <input id="f-clauseMax" type="number" placeholder="Clause max (€)" value="${dbf.clauseMax}" style="width:130px">
      ${selHtml('f-grade', [['all', 'Note : toutes'], ['A+', 'A+ uniquement'], ['A', 'A ou mieux'], ['B', 'B ou mieux'], ['C', 'C ou mieux'], ['D', 'D ou mieux']], dbf.grade)}
      ${selHtml('f-stars', [['', 'Étoiles : toutes'], ...[1, 2, 3, 4, 5].map((n) => [n, n + ' étoile(s) et +'])], dbf.stars)}
      ${selHtml('f-attr', [['none', 'Attribut…'], ...ATTR_CODES.map((x) => [x, x])], dbf.attr)}<input id="f-attrMin" type="number" placeholder="Min" value="${dbf.attrMin}" style="width:80px">
    </div><div id="dbtable"></div>
    <p class="muted">Les valeurs se précisent avec la connaissance (20 % : fourchettes larges, 100 % : valeurs exactes). Les notes A-F comparent le coureur au niveau moyen de votre équipe.
      Précision actuelle de vos recruteurs : niveau ×${db.fq.ca.toFixed(2)}, potentiel ×${db.fq.pa.toFixed(2)} (plus c'est bas, plus les fourchettes sont serrées).</p></div>`;
  c.querySelectorAll('.fbar [id^="f-"]').forEach((el) => { el.oninput = () => { dbf[el.id.slice(2)] = el.value; drawDb(mode); }; });
  drawDb(mode);
}

function drawDb(mode) {
  const f = dbf, nm = f.name.toLowerCase(), box = $('dbtable'), watch = mode === 'watch';
  let rows = db.all.filter((r) => (!watch || r.watched)
    && (!nm || (r.first_name + ' ' + r.last_name).toLowerCase().includes(nm))
    && (f.country === 'all' || r.nationality === f.country) && (!f.ageMin || r.age >= +f.ageMin) && (!f.ageMax || r.age <= +f.ageMax)
    && (f.spec === 'all' || r.spec === f.spec) && statusOk(r, f.status) && (!f.endMax || (r.contract_end_year || 9999) <= +f.endMax)
    && (!f.clauseMax || (r.kn >= 50 && (r.clause ?? r.value) <= +f.clauseMax))
    && (f.grade === 'all' || (r.est != null && GRADES.indexOf(gradeOf(r.est)) >= GRADES.indexOf(f.grade)))
    && (!f.stars || (r.est != null && starV(r.est) >= +f.stars))
    && (f.attr === 'none' || !f.attrMin || (r.kn >= 20 && attrRange(r.A[f.attr], r.id, f.attr, r.kn, db.fq.ca)[1] >= +f.attrMin)));
  const { k, d } = f.sort;
  rows.sort((a, b) => { const x = dbVal(a, k), y = dbVal(b, k); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; });
  const total = rows.length; rows = rows.slice(0, 100);
  const cols = [['', null], ['Coureur', 'name'], ['Équipe', 'team'], ['Âge', 'age'], ['Nation', 'nat'], ['Spéc.', 'spec'], ['Évaluation', 'level'], ['Potentiel', 'pot'], ['Connaissance', 'kn'],
    ['Fin de contrat', 'end'], ['Valeur estimée', 'clause'], ['Exigence salariale', 'salary'], ...(watch ? [['Note', null]] : []), ['', null]];
  const row = (r) => `<tr><td><button class="starbtn" data-watch="${r.id}" title="${r.watched ? 'Retirer de la sélection' : 'Ajouter à la sélection'}">${r.watched ? '★' : '☆'}</button></td>
    <td><a class="rl" data-rider="${r.id}"><span class="av">${esc(r.first_name[0] + r.last_name[0])}</span>${esc(r.first_name)} ${esc(r.last_name)}</a>${r.obsN ? ` <span class="bd green" title="Observé par ${r.obsN} club(s)">Observé (${r.obsN})</span>` : ''}</td>
    <td>${esc(r.team)}</td><td>${r.age}</td><td>${flag(r.nationality)}</td><td><span class="bd spec" title="${SPEC_NAMES[r.spec]}">${r.spec}</span></td>
    <td>${levelStars(r, r.kn, false, db.fq)}${gradeBadge(r)}</td><td>${potStars(r, r.kn, false, db.fq)}</td>
    <td><span class="mini"><i style="width:${r.kn}%"></i></span> ${r.kn}%</td><td>${r.contract_end_year || '-'}</td>
    <td>${moneyFog(r.clause ?? r.value, r.id, 'clause', r.kn, false)}</td><td>${moneyFog(r.contract_salary || 0, r.id, 'salary', r.kn, false)}${r.kn >= 50 ? ' / mois' : ''}</td>
    ${watch ? `<td>${esc(r.note)} <button data-note="${r.id}">Éditer</button></td>` : ''}
    <td>${r.mineObs ? '<span class="muted">En observation</span>' : r.kn >= 100 ? '<span class="muted">Connu</span>' : `<button data-obs="${r.id}">Observer</button>`}</td></tr>`;
  box.innerHTML = `<div class="muted">${total} coureur(s)${total > 100 ? ' (100 premiers affichés)' : ''}</div>
    <div class="tbl tall"><table class="fm sq"><thead><tr>${cols.map(([l, key]) => `<th ${key ? `data-sort="${key}"` : ''}>${l}${key === k ? (d < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row).join('') || `<tr><td colspan="${cols.length}" class="muted">Aucun coureur ne correspond à ces filtres.</td></tr>`}</tbody></table></div>`;

  box.onclick = async (e) => {
    const th = e.target.closest('th[data-sort]'), w = e.target.closest('[data-watch]'), o = e.target.closest('[data-obs]'), n = e.target.closest('[data-note]');
    if (th) {
      const key = th.dataset.sort;
      dbf.sort = dbf.sort.k === key ? { k: key, d: -dbf.sort.d } : { k: key, d: ['name', 'team', 'nat', 'spec', 'end'].includes(key) ? 1 : -1 };
      drawDb(mode);
    } else if (w) {                                                       // ajout / retrait de la liste de sélection en un clic
      const id = w.dataset.watch, r = db.all.find((x) => x.id === id); w.disabled = true;
      const { error } = await (r.watched ? sb.from('watchlist').delete().eq('team_id', state.team.id).eq('rider_id', id) : sb.from('watchlist').insert({ team_id: state.team.id, rider_id: id }));
      if (error) { toast(error.message); w.disabled = false; return; }
      r.watched = !r.watched; if (!r.watched) r.note = ''; drawDb(mode);
    } else if (n) {
      const r = db.all.find((x) => x.id === n.dataset.note), txt = prompt('Note sur ce coureur :', r.note);
      if (txt === null) return;
      const { error } = await sb.from('watchlist').update({ notes: txt }).eq('team_id', state.team.id).eq('rider_id', r.id);
      if (error) return toast(error.message);
      r.note = txt; drawDb(mode);
    } else if (o) {
      o.disabled = true;
      const { error } = await sb.rpc('start_observation', { p_rider: o.dataset.obs });
      if (error) { toast(error.message); o.disabled = false; return; }
      toast('Observation lancée : la connaissance progresse à chaque jour de jeu.');
      db.all.find((x) => x.id === o.dataset.obs).mineObs = true; drawDb(mode);
    }
  };
}

/* ---------- Staff de recrutement ---------- */
const zoneLabel = (a) => [a.target_region || 'Toutes zones', a.target_specialty || 'toutes spécialités', a.target_min_potential != null ? `potentiel ${a.target_min_potential}★ min` : null].filter(Boolean).join(' · ');
const bar20 = (v) => `<span class="mini"><i style="width:${v * 5}%"></i></span> ${v}/20`;

async function renderRecruiters(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const tid = state.team.id;
  const [mine, pool, asg] = await Promise.all([
    sb.from('scouts').select('*').eq('team_id', tid).order('name'),
    sb.from('scouts').select('*').is('team_id', null).order('name'),
    sb.from('scouting_assignments').select('*').eq('status', 'ACTIVE'),
  ]);
  const my = mine.data || [], act = asg.data || [], fq = scoutFactors(my);
  const card = (s, own) => {
    const m = act.find((a) => a.scout_id === s.id);
    const known = Object.entries(s.knowledge_countries || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${flag(k)} ${v}%`).join(' · ');
    return `<div class="card offer"><div class="head"><b>${esc(s.name)}</b><span class="muted">${s.age} ans · ${flag(s.country)}</span></div>
      <ul class="kv"><li>Évaluation du niveau (CA) : ${bar20(s.judging_current_ability)}</li><li>Évaluation du potentiel (PA) : ${bar20(s.judging_potential_ability)}</li><li>Adaptabilité : ${bar20(s.adaptability)}</li></ul>
      <div class="muted">Pays connus : ${known || 'aucun'}</div><div>${fmtEUR(s.monthly_salary)} / mois</div>
      ${own ? (m ? `<span class="badge warn">Mission : ${esc(zoneLabel(m))}</span>` : '<span class="badge">Disponible</span>') : ''}
      ${own ? `<button data-assign="${s.id}" ${m ? 'disabled' : ''}>Affecter une mission</button><button class="danger" data-fire="${s.id}">Licencier</button>` : `<button data-hire="${s.id}">Embaucher</button>`}</div>`;
  };
  c.innerHTML = `<div class="panel full"><h4>Staff de recrutement</h4>
      <div class="muted">${my.length} / 4 recruteurs · salaires ${fmtEUR(my.reduce((s, x) => s + Number(x.monthly_salary), 0))} / mois · précision des fourchettes : niveau ×${fq.ca.toFixed(2)}, potentiel ×${fq.pa.toFixed(2)} (plus c'est bas, mieux c'est)</div>
      <div class="grid2" style="margin-top:.6rem">${my.map((s) => card(s, true)).join('') || '<div class="card muted">Aucun recruteur : embauchez-en un ci-dessous.</div>'}</div></div>
    <div class="panel full" style="margin-top:.75rem"><h4>Recruteurs disponibles</h4><div class="grid2">${(pool.data || []).map((s) => card(s, false)).join('') || '<div class="card muted">Aucun recruteur disponible.</div>'}</div></div>`;
  c.onclick = async (e) => {
    const b = e.target.closest('[data-assign],[data-fire],[data-hire]'); if (!b) return;
    if (b.dataset.assign) { mission.scout = b.dataset.assign; return go('recruit', 'missions'); }
    if (b.dataset.fire && !confirm('Licencier ce recruteur ? Sa mission en cours sera supprimée.')) return;
    b.disabled = true;
    const { error } = b.dataset.fire ? await sb.rpc('fire_scout', { p_scout: b.dataset.fire }) : await sb.rpc('hire_scout', { p_scout: b.dataset.hire });
    if (error) { toast(error.message); b.disabled = false; return; }
    toast(b.dataset.fire ? 'Recruteur licencié.' : 'Recruteur embauché.'); renderRecruiters(c);
  };
}

async function renderRecruitOverview(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const t = state.team, tid = t.id, g = state.game, ids = myTeamIds(), ACTIVE = ['PENDING_CLUB', 'CLUB_ACCEPTED', 'NEGOTIATING_CONTRACT', 'CONTRACT_ACCEPTED'];
  const [sc, asg, rep, wl, off, rs, st, sp] = await Promise.all([
    sb.from('scouts').select('*').eq('team_id', tid),
    sb.from('scouting_assignments').select('*').eq('status', 'ACTIVE'),
    sb.from('scouting_reports').select('knowledge').eq('team_id', tid),
    sb.from('watchlist').select('rider_id', { count: 'exact', head: true }).eq('team_id', tid),
    sb.from('transfer_offers').select('*').or(`from_team_id.eq.${tid},to_team_id.eq.${tid}`),
    sb.from('riders').select('*').in('team_id', ids),
    sb.from('staff').select('monthly_salary').eq('team_id', tid),
    sb.from('team_sponsors').select('monthly_payout').eq('team_id', tid),
  ]);
  const scouts = sc.data || [], act = asg.data || [], reports = rep.data || [], offers = off.data || [], riders = enrich(rs.data || [], g.game_date);
  const sum = (a, k) => (a || []).reduce((s, x) => s + Number(x[k] || 0), 0);
  const mineO = offers.filter((o) => o.from_team_id === tid), inc = offers.filter((o) => o.to_team_id === tid);
  const inProg = mineO.filter((o) => ACTIVE.includes(o.status)), agreed = mineO.filter((o) => o.status === 'CONTRACT_ACCEPTED');
  const arrivals = mineO.filter((o) => o.status === 'OFFICIALIZED'), departures = inc.filter((o) => o.status === 'OFFICIALIZED');
  const zone = !act.length ? 'Aucune mission' : act.some((a) => !a.target_region) ? 'Monde' : [...new Set(act.map((a) => a.target_region))].join(', ');
  const payroll = sum(riders, 'contract_salary') + sum(st.data, 'monthly_salary') + sum(scouts, 'monthly_salary'), income = sum(sp.data, 'monthly_payout');
  const today = gd(g.game_date), mLeft = (r) => (r.contract_end_year ? (new Date(r.contract_end_year + '-12-31T12:00:00') - today) / (30.44 * 864e5) : 999);
  const bucket = (a, b) => riders.filter((r) => mLeft(r) >= a && mLeft(r) < b).length, expiring = riders.filter((r) => mLeft(r) < 12).sort((a, b) => mLeft(a) - mLeft(b));
  const specN = (s) => riders.filter((r) => r.spec === s).length, u23 = riders.filter((r) => r.age <= 22).length;
  const objectives = [
    ...[['MTN', 'un grimpeur'], ['SPR', 'un sprinteur'], ['CLM', 'un rouleur (contre-la-montre)'], ['VAL', 'un puncheur'], ['FLA', 'un spécialiste des pavés']].map(([s, l]) => ({
      label: `Recruter ${l}`, done: specN(s) >= 2, hint: `${specN(s)} / 2 dans l'effectif`, go: () => { dbf.spec = s; dbf.ageMax = ''; go('recruit', 'search'); } })),
    { label: 'Recruter des coureurs de moins de 23 ans', done: u23 >= 4, hint: `${u23} / 4 dans l'effectif`, go: () => { dbf.spec = 'all'; dbf.ageMax = '22'; go('recruit', 'search'); } },
    { label: 'Prolonger les contrats qui expirent sous 12 mois', done: !expiring.length, hint: `${expiring.length} coureur(s) concerné(s)`, go: () => go('squad', 'squad_pro') },
  ];
  const kv = (l, v, cls = '') => `<div class="stat-row"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  c.innerHTML = `<div class="rov">
    <div class="panel"><h4>Réseau de recrutement</h4><div class="big">${esc(zone)}</div><div class="muted">Zone active des recruteurs</div>
      ${kv('Recruteurs', scouts.length + ' / 4')}${kv('Missions actives', act.length)}${kv('Rapports disponibles', reports.filter((x) => x.knowledge >= 50).length)}${kv('Coureurs observés', reports.filter((x) => x.knowledge > 0).length)}${kv('Liste de sélection', wl.count ?? 0)}
      <div class="rov-btns"><button data-rgo="recruiters">Staff de recrutement</button><button data-rgo="missions">Recherches ciblées</button></div></div>
    <div class="panel"><h4>Marché des transferts</h4><div class="big up">Ouvert</div><div class="muted">Fenêtre de transferts</div>
      ${kv('Offres en cours', inProg.length)}${kv('Accords conclus (à officialiser)', agreed.length)}${kv('Offres reçues pour vos coureurs', inc.filter((o) => ACTIVE.includes(o.status)).length)}
      <div class="muted" style="margin-top:.5rem">Historique</div>${kv('Transferts (arrivées)', `${arrivals.length} · ${fmtEUR(sum(arrivals, 'offer_amount'))}`)}${kv('Transferts (départs)', `${departures.length} · ${fmtEUR(sum(departures, 'offer_amount'))}`)}
      <div class="rov-btns"><button data-rgo="market">Marché des transferts</button></div></div>
    <div class="panel"><h4>Budgets pour les recrutements</h4><div class="muted">Transfert / rachat disponible</div><div class="big">${fmtEUR(t.budget)}</div>
      <div class="muted" style="margin-top:.5rem">Masse salariale disponible (par mois)</div><div class="big ${income - payroll < 0 ? 'down' : ''}">${fmtEUR(income - payroll)}</div>
      ${kv('Revenus sponsors', fmtEUR(income))}${kv('Masse salariale engagée', fmtEUR(payroll))}
      <div class="muted" style="margin-top:.5rem">Recrutement (par mois)</div>${kv('Coût des recruteurs', fmtEUR(sum(scouts, 'monthly_salary')))}</div>
    <div class="panel span2"><h4>Contrats</h4><div class="big">${riders.length} coureurs sous contrat</div>
      <div class="rov-buckets">${[['0-6M', 0, 6], ['6-12M', 6, 12], ['1-2A', 12, 24], ['2A +', 24, 999]].map(([l, a, b]) => `<div class="rov-b"><b>${bucket(a, b)}</b><span>${l}</span></div>`).join('')}</div>
      <div class="muted" style="margin:.6rem 0 .3rem">Moins de 12 mois restant sur le contrat</div>
      ${expiring.length ? `<div class="rov-exp">${expiring.slice(0, 12).map((r) => `<div><a class="rl" data-rider="${r.id}">${esc(r.first_name)} ${esc(r.last_name)}</a><div class="muted">Expire le 31/12/${r.contract_end_year}</div></div>`).join('')}</div>` : '<p class="muted">Aucun contrat n\'expire dans les 12 mois.</p>'}</div>
    <div class="panel"><h4>Objectifs de recrutement</h4><div class="muted">Demandes de la direction</div>
      ${objectives.map((o, i) => `<div class="stat-row"><div>${o.label}<small>${o.hint}</small></div><span style="display:flex;gap:.4rem;align-items:center"><span class="bd ${o.done ? 'green' : 'amber'}">${o.done ? 'Atteint' : 'À faire'}</span>${o.done ? '' : `<button data-obj="${i}">Chercher</button>`}</span></div>`).join('')}</div>
  </div>`;
  c.onclick = (e) => { const b = e.target.closest('[data-rgo]'), ob = e.target.closest('[data-obj]'); if (b) b.dataset.rgo === 'recruiters' ? go('club', 'staff_scouting') : go('recruit', b.dataset.rgo); else if (ob) objectives[+ob.dataset.obj].go(); };
}

/* ---------- Recherches ciblées : missions d'observation ---------- */
async function renderMissions(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  await loadDb();
  const tid = state.team.id;
  const [mine, asg, cn] = await Promise.all([
    sb.from('scouts').select('*').eq('team_id', tid).order('name'),
    sb.from('scouting_assignments').select('*').eq('status', 'ACTIVE'),
    sb.from('countries').select('*').order('name_fr'),
  ]);
  const scouts = mine.data || [], act = asg.data || [], busy = new Set(act.map((a) => a.scout_id)), free = scouts.filter((s) => !busy.has(s.id));
  const regionOf = Object.fromEntries((cn.data || []).map((x) => [x.code, x.region]));
  const regions = [...new Set(Object.values(regionOf))];
  const zone = (a) => db.all.filter((r) => (!a.target_region || r.nationality === a.target_region || regionOf[r.nationality] === a.target_region) && (!a.target_specialty || r.spec === a.target_specialty));
  const specs = [['', 'Toutes spécialités'], ['MTN', 'Montagne (MTN)'], ['VAL', 'Vallons (VAL)'], ['CLM', 'Contre-la-montre (CLM)'], ['SPR', 'Sprint (SPR)'], ['FLA', 'Pavés (FLA)']];
  c.innerHTML = `<div class="panel full"><h4>Nouvelle mission d'observation</h4>
      ${free.length ? `<div class="fbar">
        ${selHtml('m-scout', free.map((s) => [s.id, s.name]), mission.scout)}
        ${selHtml('m-region', [['', 'Toutes les zones'], ...regions.map((x) => [x, 'Continent : ' + x]), ...(cn.data || []).map((x) => [x.code, x.name_fr])], '')}
        ${selHtml('m-spec', specs, '')}
        ${selHtml('m-pot', [['', 'Potentiel : peu importe'], ...[1, 2, 3, 4, 5].map((n) => [n, n + ' étoile(s) minimum'])], '')}
        <button id="launch">Lancer la mission</button></div>
        <p class="muted">Chaque jour de jeu, le recruteur fait progresser la connaissance de 3 coureurs de la zone (les moins connus d'abord). Il apprend aussi les pays qu'il observe.</p>`
        : `<p class="muted">${scouts.length ? 'Tous vos recruteurs ont déjà une mission.' : 'Vous n\'avez aucun recruteur.'} <a class="rl" id="tostaff">Gérer le staff de recrutement</a></p>`}</div>
    <div class="panel full" style="margin-top:.75rem"><h4>Missions en cours</h4><div class="grid2">${act.map((a) => {
      const s = scouts.find((x) => x.id === a.scout_id), z = zone(a), avg = z.length ? Math.round(z.reduce((t, r) => t + r.kn, 0) / z.length) : 0;
      return `<div class="card offer"><div class="head"><b>${esc(s ? s.name : 'Recruteur')}</b><span class="badge warn">Active</span></div>
        <div>${esc(zoneLabel(a))}</div><div class="muted">${z.length} coureurs dans la zone · connaissance moyenne ${avg} %</div>
        <div class="meter"><i style="width:${avg}%"></i></div><button class="danger" data-end="${a.id}">Arrêter la mission</button></div>`;
    }).join('') || '<div class="card muted">Aucune mission en cours.</div>'}</div></div>`;
  if ($('tostaff')) $('tostaff').onclick = () => go('club', 'staff_scouting');
  c.onclick = async (e) => {
    const b = e.target.closest('#launch,[data-end]'); if (!b) return;
    b.disabled = true;
    const { error } = b.id === 'launch'
      ? await sb.rpc('create_assignment', { p_scout: $('m-scout').value, p_region: $('m-region').value || null, p_specialty: $('m-spec').value || null, p_min_pot: $('m-pot').value === '' ? null : +$('m-pot').value })
      : await sb.rpc('end_assignment', { p_id: b.dataset.end });
    if (error) { toast(error.message); b.disabled = false; return; }
    mission.scout = null; toast(b.id === 'launch' ? 'Mission lancée.' : 'Mission arrêtée.'); renderMissions(c);
  };
}

/* =====================================================================
   NÉGOCIATION ET OFFRES DE TRANSFERT (à coller à la fin de recruit.js)
   Utilise : sb, state, esc, fmtEUR, toast, $, myTeamIds, enrich ; (si présents) flag, db, moneyFog, drawDb
   ===================================================================== */
const NEG_ACTIVE = ['PENDING_CLUB', 'CLUB_ACCEPTED', 'NEGOTIATING_CONTRACT', 'CONTRACT_ACCEPTED'];
const NEG_STATUS = { PENDING_CLUB: 'En attente du club', CLUB_ACCEPTED: 'Accord du club', NEGOTIATING_CONTRACT: 'Négociation du contrat', CONTRACT_ACCEPTED: 'Contrat accepté' };
const NEG_ROLES = [['Leader', 'Leader'], ['Équipier de luxe', 'Équipier de luxe'], ['Équipier', 'Équipier'], ['Espoir', 'Espoir U23']];   // [valeur enregistrée (contrainte SQL), libellé]
const neg = { open: new Map(), at: 0 };                                                                                                     // cache : rider_id -> offre en cours

function negStyles() {
  if ($('neg-style')) return;
  const st = document.createElement('style'); st.id = 'neg-style';
  st.textContent = `.neg-ov{position:fixed;inset:0;background:rgba(3,7,18,.75);z-index:60;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:4vh 1rem}
    .neg-box{background:#111827;border:1px solid #374151;border-radius:10px;width:100%;max-width:860px;padding:1.25rem}
    .neg-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:.8rem}
    .neg-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.neg-col{background:rgba(31,41,55,.6);border:1px solid #374151;border-radius:8px;padding:.9rem}
    .neg-col h5{margin:0 0 .6rem;color:#f9a8d4;text-transform:uppercase;font-size:.8rem}.neg-col label{display:block;margin:.55rem 0 .2rem;font-size:.8rem;color:#9ca3af}
    .neg-sum{margin-top:.8rem;font-size:.85rem;display:grid;gap:.15rem}.neg-hint{font-size:.78rem;color:#fbbf24;min-height:1.1em}
    .neg-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem}.negbtn{background:#db2777;font-size:.75rem;padding:.2rem .6rem;margin-left:.3rem}
    .negbtn:disabled{background:#374151;color:#6b7280}@media(max-width:700px){.neg-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(st);
}
const negFlag = (c) => (typeof flag === 'function' ? flag(c) : esc(c));
const negRep = (level) => (level < 55 ? 1 : level < 62 ? 2 : level < 68 ? 3 : level < 72 ? 4 : 5);   // même échelle que la fiche coureur
const negSelect = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

async function negLoadOffers(force) {
  if (!force && Date.now() - neg.at < 20000) return;
  const { data } = await sb.from('transfer_offers').select('*').eq('from_team_id', state.team.id).in('status', NEG_ACTIVE);
  neg.open = new Map((data || []).map((o) => [o.rider_id, o])); neg.at = Date.now();
}

// Ajoute le bouton « Formuler une offre » dans la dernière colonne du tableau (sans modifier drawDb)
async function negDecorate() {
  await negLoadOffers();
  const box = $('dbtable'); if (!box) return;
  box.querySelectorAll('tbody tr').forEach((tr) => {
    const id = tr.querySelector('[data-watch]')?.dataset.watch;
    if (!id || tr.querySelector('[data-offer]')) return;
    const r = typeof db !== 'undefined' && db.all ? db.all.find((x) => x.id === id) : null, o = neg.open.get(id), low = r && r.kn < 50 && !o;
    tr.lastElementChild.insertAdjacentHTML('beforeend', `<button class="negbtn" data-offer="${id}" ${low ? 'disabled title="Observez ce coureur (50 % de connaissance) avant de formuler une offre"' : ''}>${o ? 'Offre en cours' : 'Formuler une offre'}</button>`);
  });
}
if (typeof drawDb === 'function' && !drawDb.negWrapped) {
  const negOrig = drawDb;
  drawDb = function (mode) { negOrig(mode); negDecorate(); };
  drawDb.negWrapped = true;
}
if (!window.negBound) {
  window.negBound = true;
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-offer]'); if (b && !b.disabled) openNegotiationModal(b.dataset.offer); });
}
const negClose = () => { const m = $('neg-modal'); if (m) m.remove(); document.removeEventListener('keydown', negEsc); };
const negEsc = (e) => { if (e.key === 'Escape') negClose(); };
function negRefresh() { if ($('dbtable') && typeof drawDb === 'function') drawDb(state.tab === 'watch' ? 'watch' : 'search'); }

/* ---------- Modal d'offre et de négociation ---------- */
async function openNegotiationModal(riderId) {
  negStyles(); negClose();
  const ov = document.createElement('div'); ov.className = 'neg-ov'; ov.id = 'neg-modal';
  ov.innerHTML = '<div class="neg-box"><p class="muted">Chargement…</p></div>';
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) negClose(); });
  document.body.appendChild(ov); document.addEventListener('keydown', negEsc);
  const body = ov.firstElementChild, tid = state.team.id, mine = myTeamIds();

  const { data: raw } = await sb.from('riders').select('*').eq('id', riderId).maybeSingle();
  if (!raw) { body.innerHTML = '<p>Coureur introuvable.</p><div class="neg-actions"><button id="neg-x">Fermer</button></div>'; $('neg-x').onclick = negClose; return; }
  const [tm, sc, ex, pr, st, so] = await Promise.all([
    raw.team_id ? sb.from('teams').select('id, name, official_name').eq('id', raw.team_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('scouting_reports').select('knowledge').eq('team_id', tid).eq('rider_id', riderId).maybeSingle(),
    sb.from('transfer_offers').select('*').eq('from_team_id', tid).eq('rider_id', riderId).in('status', NEG_ACTIVE).maybeSingle(),
    sb.from('riders').select('contract_salary').in('team_id', mine),
    sb.from('staff').select('monthly_salary').eq('team_id', tid),
    sb.from('scouts').select('monthly_salary').eq('team_id', tid),
  ]);
  const r = enrich([raw], state.game.game_date)[0], kn = sc.data?.knowledge ?? 0, club = tm.data ? tm.data.official_name || tm.data.name : null, free = !raw.team_id;
  const sum = (a, k) => (a || []).reduce((s, x) => s + Number(x[k] || 0), 0);
  const payroll = sum(pr.data, 'contract_salary') + sum(st.data, 'monthly_salary') + sum(so.data, 'monthly_salary'), budget = Number(state.team.budget);
  const clause = r.clause ?? r.value, clauseTxt = typeof moneyFog === 'function' ? moneyFog(clause, r.id, 'clause', kn, false) : fmtEUR(clause);
  const head = `<div class="neg-head"><div><h3 style="margin:0">Offre pour ${esc(r.first_name)} ${esc(r.last_name)}</h3>
      <div class="muted">${r.age} ans · ${negFlag(r.nationality)} · ${esc(club || 'Sans contrat')}</div></div><button class="link" id="neg-x">Fermer</button></div>`;
  const stop = (msg) => { body.innerHTML = head + `<p>${msg}</p><div class="neg-actions"><button id="neg-x2">Fermer</button></div>`; $('neg-x').onclick = $('neg-x2').onclick = negClose; };

  // Cas bloquants
  if (mine.includes(raw.team_id)) return stop('Ce coureur fait déjà partie de votre effectif.');
  if (kn < 50) return stop('Observez d\'abord ce coureur : il faut au moins 50 % de connaissance pour formuler une offre.');
  const rRep = negRep(r.level), tRep = state.team.division === 'WORLD_TOUR' ? 4 : 2;
  if (rRep - tRep >= 2) return stop('L\'agent refuse de négocier : l\'écart de réputation entre ce coureur et votre équipe est trop grand.');
  if (ex.data) {
    body.innerHTML = head + `<div class="neg-col"><h5>Offre en cours</h5><div><b>${NEG_STATUS[ex.data.status] || ex.data.status}</b></div>
      <div class="neg-sum"><span>Indemnité : ${fmtEUR(ex.data.offer_amount)}${ex.data.installments_months ? ` sur ${ex.data.installments_months} mois` : ' (paiement immédiat)'}</span>
      <span>Revente : ${ex.data.sell_on_clause_pct} % · Salaire : ${fmtEUR(ex.data.offered_monthly_salary)} / mois · Rôle : ${esc(ex.data.offered_role || '-')}</span></div></div>
      <div class="neg-actions"><button class="danger" id="neg-cancel">Annuler cette offre</button><button id="neg-x2">Fermer</button></div>`;
    $('neg-x').onclick = $('neg-x2').onclick = negClose;
    $('neg-cancel').onclick = async () => {
      const { error } = await sb.from('transfer_offers').update({ status: 'CANCELLED' }).eq('id', ex.data.id);
      if (error) return toast(error.message);
      neg.open.delete(riderId); neg.at = Date.now(); toast('Offre annulée.'); negClose(); negRefresh();
    };
    return;
  }

  // Formulaire
  body.innerHTML = head + `<div class="neg-grid">
      <div class="neg-col"><h5>Offre au club${club ? ' : ' + esc(club) : ''}</h5>
        ${free ? '<p class="muted">Coureur sans contrat : aucune indemnité de transfert.</p>' : ''}
        <label>Indemnité de transfert directe (€)</label><input id="neg-amount" type="number" min="0" step="1000" value="${free ? 0 : ''}" ${free ? 'disabled' : ''} placeholder="Montant en euros">
        ${free ? '' : `<div class="muted" style="font-size:.78rem">Clause libératoire estimée : ${clauseTxt}. Une offre égale ou supérieure à la clause ne peut pas être refusée par le club.</div>`}
        <label>Échelonnement</label>${negSelect('neg-inst', [[0, 'Paiement immédiat'], [12, 'Sur 12 mois'], [24, 'Sur 24 mois'], [36, 'Sur 36 mois']], 0)}
        <label>Pourcentage sur la prochaine revente : <b id="neg-pctv">0</b> %</label><input id="neg-pct" type="range" min="0" max="50" step="1" value="0"></div>
      <div class="neg-col"><h5>Contrat du coureur</h5>
        <label>Salaire mensuel proposé (€ / mois)</label><input id="neg-salary" type="number" min="0" step="100" placeholder="Salaire mensuel">
        <div class="muted" style="font-size:.78rem">Exigence estimée : ${typeof moneyFog === 'function' ? moneyFog(r.contract_salary || 0, r.id, 'salary', kn, false) + ' / mois' : 'à découvrir'}</div>
        <label>Rôle convenu</label>${negSelect('neg-role', NEG_ROLES, 'Équipier')}
        <div class="neg-hint" id="neg-roleh"></div></div></div>
    <div class="neg-sum" id="neg-sum"></div><div class="neg-hint" id="neg-err" style="color:#f87171"></div>
    <div class="neg-actions"><button class="link" id="neg-x2">Annuler</button><button id="neg-send">Envoyer l'offre</button></div>`;
  $('neg-x').onclick = $('neg-x2').onclick = negClose;

  const val = () => ({ amount: free ? 0 : +$('neg-amount').value || 0, inst: +$('neg-inst').value, pct: +$('neg-pct').value, salary: +$('neg-salary').value || 0, role: $('neg-role').value });
  const update = () => {
    const v = val(), first = v.inst ? v.amount / v.inst : v.amount;
    $('neg-pctv').textContent = v.pct;
    $('neg-roleh').textContent = v.role === 'Leader' ? 'Un rôle de leader peut frustrer vos coureurs actuels s\'il ne correspond pas au temps de course accordé.' : '';
    $('neg-sum').innerHTML = `<span>${v.inst ? `Mensualité de transfert : ${fmtEUR(Math.round(first))} pendant ${v.inst} mois` : `Paiement immédiat : ${fmtEUR(v.amount)}`}</span>
      <span>Budget après le premier paiement : ${fmtEUR(Math.round(budget - first))}</span><span>Masse salariale mensuelle : ${fmtEUR(payroll)} → ${fmtEUR(payroll + v.salary)}</span>`;
  };
  ['neg-amount', 'neg-inst', 'neg-pct', 'neg-salary', 'neg-role'].forEach((id) => { if ($(id)) $(id).oninput = update; });
  update();

  $('neg-send').onclick = async () => {
    const v = val(), err = (m) => { $('neg-err').textContent = m; }, first = v.inst ? v.amount / v.inst : v.amount;
    if (!free && v.amount <= 0) return err('Indiquez une indemnité de transfert.');
    if (![0, 12, 24, 36].includes(v.inst)) return err('Échelonnement invalide.');
    if (v.pct < 0 || v.pct > 50) return err('Le pourcentage de revente doit être compris entre 0 et 50 %.');
    if (!(v.salary > 0)) return err('Proposez un salaire mensuel.');
    if (first > budget) return err(`Budget insuffisant : le premier paiement est de ${fmtEUR(Math.round(first))}.`);
    $('neg-send').disabled = true; err('');
    const { data, error } = await sb.from('transfer_offers').insert({
      from_team_id: tid, to_team_id: raw.team_id || null, rider_id: riderId, offer_amount: v.amount, installments_months: v.inst,
      sell_on_clause_pct: v.pct, offered_monthly_salary: v.salary, offered_role: v.role, status: 'PENDING_CLUB' }).select().single();
    if (error) { $('neg-send').disabled = false; err(error.message); return; }
    neg.open.set(riderId, data); neg.at = Date.now();
    toast(`Offre envoyée${club ? ' à ' + club : ''} pour ${r.first_name} ${r.last_name}.`);
    negClose(); negRefresh();
  };
}
