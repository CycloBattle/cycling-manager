// recruit.js — Recrutement : base de données cyclistes + liste de sélection
// Utilise sb, state, esc, fmtEUR, NATS, toast, $, myTeamIds (app.js), flag, stars, enrich, SPEC_FILTERS, SPEC_NAMES (squad.js), attrsOf (rider.js)
const ATTR_CODES = ['MTN', 'MM', 'HIL', 'FLA', 'COB', 'SPR', 'ACC', 'TTR', 'PRL', 'DHI', 'ATT', 'STA', 'RES', 'REC'];
const dbf = { name: '', country: 'all', ageMin: '', ageMax: '', spec: 'all', endMax: '', attr: 'none', attrMin: '', status: 'all', sort: { k: 'level', d: -1 } };
const db = { all: [] };

async function loadDb() {
  const tid = state.team.id, mine = new Set(myTeamIds());
  const [rs, tm, sc, ob, wl] = await Promise.all([
    sb.from('riders').select('*'),
    sb.from('teams').select('id, name, official_name'),
    sb.from('scouting_reports').select('rider_id, knowledge').eq('team_id', tid),
    sb.from('rider_observations').select('rider_id, observer_team_id'),
    sb.from('watchlist').select('rider_id').eq('team_id', tid),
  ]);
  const teamName = Object.fromEntries((tm.data || []).map((t) => [t.id, t.official_name || t.name]));
  const know = Object.fromEntries((sc.data || []).map((x) => [x.rider_id, x.knowledge]));
  const obsN = {}, mineObs = new Set();
  (ob.data || []).forEach((o) => { if (o.observer_team_id === tid) mineObs.add(o.rider_id); else obsN[o.rider_id] = (obsN[o.rider_id] || 0) + 1; });
  const watch = new Set((wl.data || []).map((x) => x.rider_id));
  db.all = enrich((rs.data || []).filter((r) => !mine.has(r.team_id)), state.game.game_date).map((r) => ({
    ...r, team: r.team_id ? teamName[r.team_id] || '-' : 'Sans contrat', kn: know[r.id] ?? 0, obsN: obsN[r.id] || 0, mineObs: mineObs.has(r.id), watched: watch.has(r.id), A: attrsOf(r) }));
}

// Les valeurs masquées (brouillard de guerre) ne servent pas au tri : pas de fuite d'information
function dbVal(r, k) {
  if (k === 'name') return r.last_name;
  if (k === 'team') return r.team;
  if (k === 'nat') return r.nationality;
  if (k === 'level') return r.kn >= 50 ? r.level : -1;
  if (k === 'pot') return r.kn >= 75 ? r.pot : -1;
  if (k === 'clause') return r.kn >= 50 ? r.clause ?? r.value : -1;
  if (k === 'end') return r.contract_end_year || 0;
  return r[k] ?? 0;
}

async function renderDatabase(c, mode) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  await loadDb();
  const countries = [...new Set(db.all.map((r) => r.nationality))].sort();
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  c.innerHTML = `<div class="panel full"><h4>${mode === 'watch' ? 'Liste de sélection' : 'Base de données cyclistes'}</h4>
    <div class="fbar">
      <input id="f-name" placeholder="Nom" value="${esc(dbf.name)}">
      ${sel('f-country', [['all', 'Tous les pays'], ...countries.map((x) => [x, NATS[x] || x])], dbf.country)}
      <input id="f-ageMin" type="number" placeholder="Âge min" value="${dbf.ageMin}" style="width:90px"><input id="f-ageMax" type="number" placeholder="Âge max" value="${dbf.ageMax}" style="width:90px">
      ${sel('f-spec', Object.entries(SPEC_FILTERS), dbf.spec)}
      <input id="f-endMax" type="number" placeholder="Fin de contrat ≤ (année)" value="${dbf.endMax}" style="width:170px">
      ${sel('f-status', [['all', 'Tous les statuts'], ['free', 'Sans contrat'], ['signed', 'Sous contrat']], dbf.status)}
      ${sel('f-attr', [['none', 'Attribut…'], ...ATTR_CODES.map((x) => [x, x])], dbf.attr)}<input id="f-attrMin" type="number" placeholder="Min" value="${dbf.attrMin}" style="width:80px">
    </div><div id="dbtable"></div>
    <p class="muted">Les notes se révèlent à 50 % de connaissance, le potentiel à 75 %. Un filtre sur un attribut ne s'applique qu'aux coureurs dont les notes sont connues.</p></div>`;
  c.querySelectorAll('.fbar [id^="f-"]').forEach((el) => { el.oninput = () => { dbf[el.id.slice(2)] = el.value; drawDb(mode); }; });
  drawDb(mode);
}

function drawDb(mode) {
  const f = dbf, nm = f.name.toLowerCase(), box = $('dbtable');
  let rows = db.all.filter((r) => (mode === 'search' || r.watched)
    && (!nm || (r.first_name + ' ' + r.last_name).toLowerCase().includes(nm))
    && (f.country === 'all' || r.nationality === f.country) && (!f.ageMin || r.age >= +f.ageMin) && (!f.ageMax || r.age <= +f.ageMax)
    && (f.spec === 'all' || r.spec === f.spec) && (!f.endMax || (r.contract_end_year || 9999) <= +f.endMax)
    && (f.status === 'all' || (f.status === 'free' ? !r.team_id : !!r.team_id))
    && (f.attr === 'none' || !f.attrMin || (r.kn >= 50 && r.A[f.attr] >= +f.attrMin)));
  const { k, d } = f.sort;
  rows.sort((a, b) => { const x = dbVal(a, k), y = dbVal(b, k); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; });
  const total = rows.length; rows = rows.slice(0, 100);
  const unk = '<span class="muted">?</span>';
  const cols = [['', null], ['Coureur', 'name'], ['Équipe', 'team'], ['Âge', 'age'], ['Nation', 'nat'], ['Spéc.', 'spec'], ['Niveau', 'level'], ['Potentiel', 'pot'], ['Connaissance', 'kn'], ['Fin de contrat', 'end'], ['Clause', 'clause'], ['', null]];
  const row = (r) => `<tr><td><button class="starbtn" data-watch="${r.id}" title="Liste de sélection">${r.watched ? '★' : '☆'}</button></td>
    <td><a class="rl" data-rider="${r.id}"><span class="av">${esc(r.first_name[0] + r.last_name[0])}</span>${esc(r.first_name)} ${esc(r.last_name)}</a>${r.obsN ? ` <span class="bd green" title="Observé par ${r.obsN} club(s)">Observé (${r.obsN})</span>` : ''}</td>
    <td>${esc(r.team)}</td><td>${r.age}</td><td>${flag(r.nationality)}</td><td><span class="bd spec" title="${SPEC_NAMES[r.spec]}">${r.spec}</span></td>
    <td>${r.kn >= 50 ? stars(r.level) : unk}</td><td>${r.kn >= 75 ? stars(r.pot) : unk}</td>
    <td><span class="mini"><i style="width:${r.kn}%"></i></span> ${r.kn}%</td><td>${r.contract_end_year || '-'}</td><td>${r.kn >= 50 ? fmtEUR(r.clause ?? r.value) : unk}</td>
    <td>${r.mineObs ? '<span class="muted">En observation</span>' : r.kn >= 100 ? '<span class="muted">Connu</span>' : `<button data-obs="${r.id}">Observer</button>`}</td></tr>`;
  box.innerHTML = `<div class="muted">${total} coureur(s)${total > 100 ? ' (100 premiers affichés)' : ''}</div>
    <div class="tbl tall"><table class="fm sq"><thead><tr>${cols.map(([l, key]) => `<th ${key ? `data-sort="${key}"` : ''}>${l}${key === k ? (d < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row).join('') || '<tr><td colspan="12" class="muted">Aucun coureur ne correspond à ces filtres.</td></tr>'}</tbody></table></div>`;

  box.onclick = async (e) => {
    const th = e.target.closest('th[data-sort]'), w = e.target.closest('[data-watch]'), o = e.target.closest('[data-obs]');
    if (th) {
      const key = th.dataset.sort;
      dbf.sort = dbf.sort.k === key ? { k: key, d: -dbf.sort.d } : { k: key, d: ['name', 'team', 'nat', 'spec', 'end'].includes(key) ? 1 : -1 };
      drawDb(mode);
    } else if (w) {
      const id = w.dataset.watch, r = db.all.find((x) => x.id === id); w.disabled = true;
      const { error } = await (r.watched ? sb.from('watchlist').delete().eq('team_id', state.team.id).eq('rider_id', id) : sb.from('watchlist').insert({ team_id: state.team.id, rider_id: id }));
      if (error) { toast(error.message); w.disabled = false; return; }
      r.watched = !r.watched; drawDb(mode);
    } else if (o) {
      o.disabled = true;
      const { error } = await sb.rpc('start_observation', { p_rider: o.dataset.obs });
      if (error) { toast(error.message); o.disabled = false; return; }
      toast('Observation lancée : la connaissance progresse à chaque jour de jeu.');
      db.all.find((x) => x.id === o.dataset.obs).mineObs = true; drawDb(mode);
    }
  };
}
