// squad.js — Effectif > Vue d'ensemble (utilise sb, state, esc, fmtEUR, fmtShort, gd, PROFILES, $, toast d'app.js)
const SPEC_NAMES = { G: 'Grimpeur', S: 'Sprinteur', R: 'Rouleur / CLM', P: 'Puncheur', F: 'Flandrien', EQ: 'Équipier' };
const sq = { view: 'general', squad: 'all', spec: 'all', sort: { k: 'level', d: -1 }, sel: new Set(), lastTab: null, all: [] };
const STAT_KEYS = [['flat', 'Plat'], ['mountain', 'Mont.'], ['hills', 'Côtes'], ['time_trial', 'CLM'], ['sprint', 'Sprint'], ['cobbles', 'Pavés'], ['stamina', 'Endur.'], ['recovery', 'Récup.']];
const starV = (v) => Math.max(0.5, Math.min(5, Math.round(((v - 35) / 12) * 2) / 2));
const stars = (v) => `<span class="stars" style="--v:${starV(v)}" title="${v}">★★★★★</span>`;
const flag = (c) => `<img class="flag" src="https://flagcdn.com/w20/${esc(String(c).toLowerCase())}.png" alt="" onerror="this.style.display='none'"> ${esc(c)}`;

// Niveau, potentiel, spécialité, rôle et valeur sont calculés à partir des notes (aucune colonne dédiée en base)
function enrich(riders, today) {
  const map = { mountain: 'G', sprint: 'S', time_trial: 'R', hills: 'P', cobbles: 'F' };
  const out = riders.map((r) => {
    const top = ['flat', 'mountain', 'hills', 'time_trial', 'sprint', 'cobbles'].map((k) => r[k] || 0).sort((a, b) => b - a);
    const level = Math.round((top[0] + top[1] + top[2]) / 3);
    const best = Object.keys(map).reduce((a, k) => ((r[k] || 0) > (r[a] || 0) ? k : a), 'mountain');
    const pot = Math.min(95, Math.round(level + Math.max(0, 28 - r.age) * 1.6));
    const value = Math.round(((level - 30) ** 2 * 900 * (1 + Math.max(0, 30 - r.age) * 0.06) * (1 + (pot - level) / 60)) / 1000) * 1000;
    return { ...r, level, pot, value, spec: level < 50 ? 'EQ' : map[best], form: 100 - (r.fatigue || 0), u23: r.age <= 22, injured: !!(r.injured_until && r.injured_until > today) };
  });
  const byLevel = out.slice().sort((a, b) => b.level - a.level);
  byLevel.forEach((r, i) => { r.role = i < 2 ? 'Leader' : null; });
  const pilot = byLevel.filter((r) => !r.role).sort((a, b) => b.flat - a.flat)[0];
  if (pilot) pilot.role = 'Poisson-pilote';
  byLevel.forEach((r, i) => { if (!r.role) r.role = r.u23 && r.pot - r.level >= 8 ? 'Jeune espoir' : i < 6 ? 'Équipier de luxe' : 'Équipier'; });
  return out;
}

const badges = (r) => [r.injured && '<span class="bd red">Blessé</span>', r.selected && '<span class="bd blue">Sélectionné</span>', r.u23 && '<span class="bd violet">U23</span>',
  !r.injured && r.fatigue <= 25 && '<span class="bd green">Forme</span>', r.fatigue > 60 && '<span class="bd amber">Fatigué</span>'].filter(Boolean).join(' ');
const bar = (v, inv) => `<span class="mini"><i class="${(inv ? 100 - v : v) < 40 ? 'lo' : ''}" style="width:${v}%"></i></span> ${v}%`;

const COLS = {
  status: ['Statut', 'injured', badges],
  name: ['Coureur', 'name', (r) => `<span class="av">${esc((r.first_name[0] || '') + (r.last_name[0] || ''))}</span>${esc(r.first_name)} ${esc(r.last_name)}`],
  spec: ['Spécialité', 'spec', (r) => `<span class="bd spec" title="${SPEC_NAMES[r.spec]}">${r.spec}</span> ${SPEC_NAMES[r.spec]}`],
  role: ['Rôle', 'role', (r) => r.role],
  age: ['Âge', 'age', (r) => r.age],
  nat: ['Nation', 'nat', (r) => flag(r.nationality)],
  level: ['Niveau', 'level', (r) => stars(r.level)],
  pot: ['Potentiel', 'pot', (r) => stars(r.pot)],
  form: ['Forme', 'form', (r) => bar(r.form)],
  fatigue: ['Fatigue', 'fatigue', (r) => bar(r.fatigue || 0, true)],
  value: ['Valeur estimée', 'value', (r) => fmtEUR(r.value)],
  salary: ['Salaire', 'contract_salary', (r) => `${fmtEUR(r.contract_salary || 0)} / mois`],
  end: ['Fin de contrat', 'contract_end_year', (r) => r.contract_end_year || '-'],
  injury: ['Blessure', 'injured', (r) => (r.injured ? `${esc(r.injury_type || 'Blessure')} : retour le ${fmtShort(r.injured_until)}` : '-')],
  ...Object.fromEntries(STAT_KEYS.map(([k, l]) => [k, [l, k, (r) => r[k]]])),
};
const VIEWS = {
  general: ['Infos générales', ['status', 'name', 'spec', 'role', 'age', 'nat', 'level', 'pot', 'form', 'value', 'salary']],
  attrs: ['Attributs physiques / Spécialités', ['name', 'spec', ...STAT_KEYS.map((x) => x[0])]],
  form: ['Forme & Fatigue', ['status', 'name', 'form', 'fatigue', 'recovery', 'injury']],
  contracts: ['Contrats & Salaires', ['name', 'age', 'salary', 'end', 'value']],
};
const SPEC_FILTERS = { all: 'Tous les profils', G: 'Grimpeurs', S: 'Sprinteurs', R: 'Rouleurs / CLM', P: 'Puncheurs', F: 'Flandriens', EQ: 'Équipiers' };

async function renderSquad(c, tab) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const t = state.team, g = state.game;
  if (tab !== sq.lastTab) { sq.squad = { squad_pro: 'pro', squad_u23: 'u23' }[tab] || 'all'; sq.lastTab = tab; sq.sel.clear(); }
  const [rs, en] = await Promise.all([
    sb.from('riders').select('*').eq('team_id', t.id),
    state.nextRace ? sb.from('race_entries').select('race_entry_riders(rider_id)').eq('team_id', t.id).eq('race_id', state.nextRace.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const picked = new Set((en.data?.race_entry_riders || []).map((x) => x.rider_id));
  sq.all = enrich(rs.data || [], g.game_date).map((r) => ({ ...r, selected: picked.has(r.id) }));
  drawSquad(c);
}

function sideWidgets(all, g) {
  const n = all.length || 1, inj = all.filter((r) => r.injured), avgFat = Math.round(all.reduce((s, r) => s + (r.fatigue || 0), 0) / n);
  const risk = Math.min(100, Math.round(avgFat * 0.7 + (inj.length / n) * 50));
  const nat = {}; all.forEach((r) => (nat[r.nationality] = (nat[r.nationality] || 0) + 1));
  const cohesion = Math.max(0, ...Object.values(nat)) / n;
  const mood = Math.max(0, Math.min(100, Math.round(70 + cohesion * 20 - avgFat * 0.3 - inj.length * 3)));
  const moodL = mood >= 75 ? ['Très bonne', 'up'] : mood >= 50 ? ['Moyenne', ''] : ['Critique', 'down'];
  const caps = all.slice().sort((a, b) => b.age + b.level - (a.age + a.level)).slice(0, 2);
  const plan = ['Foncier', 'Montagne', 'Sprint', 'CLM', 'Récup.', 'Foncier', 'Repos'], today = (gd(g.game_date).getDay() + 6) % 7;
  const weeks = (r) => Math.max(1, Math.ceil((gd(r.injured_until) - gd(g.game_date)) / 6048e5));
  return { mood, moodL, html: `
    <div class="panel"><h4>Santé & infirmerie</h4><div class="big">${inj.length}</div><div class="muted">coureur(s) indisponible(s)</div>
      ${inj.map((r) => `<div class="stat-row"><span>${esc(r.last_name)}<small>${esc(r.injury_type || 'Blessure')}</small></span><b>${weeks(r)} sem.</b></div>`).join('')}
      <div class="muted" style="margin-top:.5rem">Risque de blessure de l'équipe : ${risk}%</div><div class="meter"><i style="width:${risk}%"></i></div></div>
    <div class="panel"><h4>Entraînement du mois</h4><div class="week">${['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'].map((d, i) => `<div class="${i === today ? 'today' : ''}"><b>${d}</b><br>${plan[i]}</div>`).join('')}</div>
      <div class="stat-row"><span>En progression (estimation)</span><b class="up">${all.filter((r) => r.age <= 24).length}</b></div>
      <div class="stat-row"><span>En déclin (estimation)</span><b class="down">${all.filter((r) => r.age >= 32).length}</b></div></div>
    <div class="panel"><h4>Dynamique de groupe</h4><div class="big ${moodL[1]}">${moodL[0]}</div><div class="meter"><i style="width:${mood}%"></i></div>
      <div class="muted" style="margin-top:.5rem">Capitaines de route</div>${caps.map((r) => `<div>${esc(r.first_name)} ${esc(r.last_name)} <span class="muted">(${r.age} ans)</span></div>`).join('') || '<div class="muted">-</div>'}</div>` };
}

function drawSquad(c) {
  const g = state.game, t = state.team, all = sq.all, side = sideWidgets(all, g);
  let rows = all.filter((r) => sq.squad === 'all' || (sq.squad === 'u23' ? r.u23 : !r.u23)).filter((r) => sq.spec === 'all' || r.spec === sq.spec);
  const { k, d } = sq.sort, val = (r) => (k === 'name' ? r.last_name : k === 'nat' ? r.nationality : r[k] ?? 0);
  rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; });
  const keys = VIEWS[sq.view][1], sel = (o, cur, id) => `<select data-ctl="${id}">${Object.entries(o).map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  const tired = all.filter((r) => r.fatigue > 60), inj = all.filter((r) => r.injured), nr = state.nextRace;
  const tips = [tired.length && `${tired.length} coureur(s) accusent un pic de fatigue.`, inj.length && `${inj.length} coureur(s) à l'infirmerie.`,
    nr && `Prochaine course : ${nr.name} dans ${Math.max(0, Math.round((gd(nr.date) - gd(g.game_date)) / 864e5))} jour(s).`, `${all.filter((r) => r.u23).length} coureur(s) U23 dans l'effectif.`].filter(Boolean);
  const card = (title, sub, det) => `<div class="icard"><div><b>${title}</b><div class="muted">${sub}</div></div><div class="det">${det}</div></div>`;

  c.innerHTML = `<div class="sq-layout"><div>
    <div class="icards">
      ${card('Conseils du staff', `Insights (${tips.length})`, tips.map(esc).join('<br>'))}
      ${card("Réunion d'équipe", `État d'esprit : ${side.moodL[0]}`, `Ambiance ${side.mood}/100 avant ${nr ? esc(nr.name) : 'la prochaine échéance'}.`)}
      ${card('Responsabilités', 'Manager et directeurs sportifs', 'Sélection des courses : manager<br>Programme d\'entraînement : entraîneurs<br>Communication : attaché de presse')}
    </div>
    <div class="panel"><h4>${sq.squad === 'u23' ? 'Équipe Développement (U23)' : sq.squad === 'pro' ? 'Équipe Pro' : 'Effectif complet'}</h4>
      <div class="sq-bar"><div><b>${esc(t.official_name || t.name)}</b><div class="muted">Coureurs : ${rows.length} / ${all.length}${sq.sel.size ? ` · ${sq.sel.size} sélectionné(s)` : ''}</div></div>
        <div class="sq-ctl">${sel(Object.fromEntries(Object.entries(VIEWS).map(([v, x]) => [v, x[0]])), sq.view, 'view')}
          ${sel({ all: 'Tous', pro: 'Équipe Première (Pro)', u23: 'Équipe Développement (U23)' }, sq.squad, 'squad')}${sel(SPEC_FILTERS, sq.spec, 'spec')}</div></div>
      <div class="tbl"><table class="fm sq"><thead><tr><th><input type="checkbox" data-selall ${rows.length && rows.every((r) => sq.sel.has(r.id)) ? 'checked' : ''}></th>
        ${keys.map((x) => `<th data-sort="${COLS[x][1]}">${COLS[x][0]}${COLS[x][1] === k ? (d < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.injured ? 'inj' : ''}"><td><input type="checkbox" data-sel="${r.id}" ${sq.sel.has(r.id) ? 'checked' : ''}></td>${keys.map((x) => `<td>${COLS[x][2](r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${keys.length + 1}" class="muted">Aucun coureur pour ce filtre.</td></tr>`}</tbody></table></div></div>
    </div><div>${side.html}</div></div>`;

  c.onchange = (e) => {
    const x = e.target;
    if (x.dataset.ctl) { sq[x.dataset.ctl] = x.value; drawSquad(c); }
    else if (x.dataset.sel) { x.checked ? sq.sel.add(x.dataset.sel) : sq.sel.delete(x.dataset.sel); drawSquad(c); }
    else if ('selall' in x.dataset) { rows.forEach((r) => (x.checked ? sq.sel.add(r.id) : sq.sel.delete(r.id))); drawSquad(c); }
  };
  c.onclick = (e) => {
    const th = e.target.closest('th[data-sort]'), ic = e.target.closest('.icard');
    if (th) { const key = th.dataset.sort; sq.sort = sq.sort.k === key ? { k: key, d: -sq.sort.d } : { k: key, d: key === 'name' || key === 'role' || key === 'nat' ? 1 : -1 }; drawSquad(c); }
    else if (ic) ic.classList.toggle('open');
  };
}
