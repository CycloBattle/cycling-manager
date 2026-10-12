// rider.js — Fiche coureur (utilise sb, state, esc, fmtEUR, fmtShort, go, logoSrc, enrich, stars, flag, SPEC_NAMES, moralOf, moralLabel d'app.js / squad.js)
const hashN = (s) => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
const ATTR_BLOCKS = [
  ['Aptitudes en course', [['MTN', 'Montagne'], ['MM', 'Moyenne montagne'], ['HIL', 'Vallons'], ['FLA', 'Plaine'], ['COB', 'Pavés'], ['SPR', 'Sprint'], ['ACC', 'Accélération'], ['TTR', 'Contre-la-montre'], ['PRL', 'Prologue']]],
  ['Physiologie', [['DHI', 'Descente'], ['ATT', 'Attaque'], ['STA', 'Endurance'], ['RES', 'Résistance'], ['REC', 'Récupération']]],
];
const PHYS = ['MTN', 'MM', 'HIL', 'SPR', 'ACC', 'ATT', 'PRL', 'TTR'];
const TRAITS = ['Perfectionniste', 'Leader né', 'Inconstant', 'Guerrier / combatif', "Travailleur de l'ombre", 'Mercenaire', 'Ambitieux'];
const REPUTATIONS = ['Locale', 'Nationale', 'Continentale', 'Internationale', 'Légende du peloton'];
const FOCUS = { MTN: 'Spécifique montagne', VAL: 'Vallons et puncheurs', CLM: 'Contre-la-montre', SPR: 'Trains de sprint', FLA: 'Pavés et flandriennes', PST: 'Polyvalence', EQP: 'Endurance de base' };

// Les 14 attributs (50-85) sont déduits des 8 notes stockées en base
function attrsOf(r) {
  if (r.mtn != null) return { MTN: r.mtn, MM: r.mm, HIL: r.hil, FLA: r.fla, COB: r.cob, SPR: r.spr, ACC: r.acc, TTR: r.ttr, PRL: r.prl, DHI: r.dhi, ATT: r.att, STA: r.sta, RES: r.res, REC: r.rec };   // vraies notes importées
  const v = (k) => r[k] || 0, avg = (...a) => a.reduce((x, y) => x + y, 0) / a.length, off = (c) => (hashN(r.id + c) % 5) - 2;
  const raw = { MTN: v('mountain'), MM: avg(v('mountain'), v('hills')), HIL: v('hills'), FLA: v('flat'), COB: v('cobbles'), SPR: v('sprint'),
    ACC: avg(v('sprint'), v('hills')) + off('ACC'), TTR: v('time_trial'), PRL: avg(v('time_trial'), v('sprint')) + off('PRL'),
    DHI: avg(v('hills'), v('cobbles')) + off('DHI'), ATT: avg(v('hills'), v('sprint'), v('mountain')) + off('ATT'),
    STA: v('stamina'), RES: avg(v('stamina'), v('recovery')) + off('RES'), REC: v('recovery') };
  return Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, Math.max(50, Math.min(85, Math.round(50 + ((x - 40) * 35) / 34)))]));
}
// Tendance selon l'âge, la fatigue et les blessures
function trendOf(code, r) {
  const h = hashN(r.id + code) % 3;
  if (r.injured && PHYS.includes(code)) return 'down';
  if (r.fatigue > 70 && ['REC', 'STA', 'RES'].includes(code)) return 'down';
  if (r.age <= 23) return h ? 'up' : 'flat';
  if (r.age >= 31 && PHYS.includes(code)) return h ? 'down' : 'flat';
  if (r.age >= 31 && ['DHI', 'RES'].includes(code)) return 'up';
  return 'flat';
}
const tone = (n) => (n >= 80 ? 'g4' : n >= 70 ? 'g3' : n >= 60 ? 'g2' : 'g1');

function openRider(id) { state.rid = id; go(state.menu, 'rider'); }
document.addEventListener('click', (e) => { const a = e.target.closest('[data-rider]'); if (a) { e.preventDefault(); openRider(a.dataset.rider); } });

async function renderRider(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const g = state.game, mine = state.team.id;
  const { data: r0, error } = await sb.from('riders').select('*').eq('id', state.rid || '').maybeSingle();
  if (!r0) {
    c.innerHTML = `<div class="panel"><h4>Coureur introuvable</h4><div class="muted">${esc(error?.message || 'Aucun coureur sélectionné : revenez au tableau et cliquez sur un nom.')}</div><p><a class="rl" data-back>Retour</a></p></div>`;
    c.querySelector('[data-back]').onclick = () => step(-1); return;
  }
  r0.teams = r0.team_id ? (await sb.from('teams').select('*').eq('id', r0.team_id).maybeSingle()).data : null;
  const [mates, res, sc, obs, ai, tms, myObs] = await Promise.all([
    r0.team_id ? sb.from('riders').select('*').eq('team_id', r0.team_id) : Promise.resolve({ data: [r0] }),
    sb.from('race_results').select('position, uci_points, races(date)').eq('rider_id', r0.id),
    r0.team_id === mine ? Promise.resolve({ data: null }) : sb.from('scouting_reports').select('knowledge').eq('team_id', mine).eq('rider_id', r0.id).maybeSingle(),
    sb.from('rider_observations').select('observer_ai_id, observer_team_id').eq('rider_id', r0.id),
    sb.from('ai_clubs').select('id, name'),
    sb.from('teams').select('id, name, official_name'),
    sb.from('rider_observations').select('rider_id').eq('observer_team_id', mine),
  ]);
  const r = enrich(mates.data || [r0], g.game_date).find((x) => x.id === r0.id);
  // Brouillard de guerre : notes à 50 % de connaissance, potentiel et détails à 75 %
  const own = r0.team_id === mine, kn = own ? 100 : (sc.data?.knowledge ?? 0), known = kn >= 50, deep = kn >= 75;
  const names = { ...Object.fromEntries((ai.data || []).map((x) => [x.id, x.name])), ...Object.fromEntries((tms.data || []).map((x) => [x.id, x.official_name || x.name])) };
  const watchers = (obs.data || []).filter((o) => o.observer_team_id !== mine).map((o) => names[o.observer_ai_id || o.observer_team_id] || 'Club');
  const watching = (obs.data || []).some((o) => o.observer_team_id === mine), used = (myObs.data || []).length;
  const st = { days: 0, wins: 0, pods: 0, pts: 0 };
  (res.data || []).filter((x) => String(x.races?.date || '').slice(0, 4) === String(g.season_year)).forEach((x) => { st.days++; if (x.position === 1) st.wins++; if (x.position <= 3) st.pods++; st.pts += x.uci_points || 0; });
  r.moral = moralOf(r);

  const A = attrsOf(r), exp = Math.max(1, Math.min(20, Math.round((r.age - 18) * 0.9 + (hashN(r.id) % 3)))), rep = r.level < 55 ? 1 : r.level < 62 ? 2 : r.level < 68 ? 3 : r.level < 72 ? 4 : 5;
  const t1 = hashN(r.id) % 7, t2 = (hashN(r.id + 'b') >>> 3) % 7, traits = [TRAITS[t1], t2 !== t1 ? TRAITS[t2] : null].filter(Boolean);
  const [mood, moodCls] = moralLabel(r.moral), team = r0.teams, num = (hashN(r.id) % 98) + 1;
  const note = Math.max(5, Math.min(9.9, 6 + (hashN(r.id + 'n') % 40) / 10 + (r.level - 55) / 20)).toFixed(2).replace('.', ',');
  const risk = r.fatigue > 70 || st.days > 40 ? 'Élevé' : r.fatigue > 45 || st.days > 25 ? 'Modéré' : 'Faible';
  const pos = [r.fatigue <= 25 && 'Très bonne fraîcheur', r.role === 'Leader' && 'Rôle de leader reconnu', r.u23 && r.pot - r.level >= 8 && 'Belles perspectives de progression', r.contract_end_year >= g.season_year + 2 && 'Contrat sécurisé'].filter(Boolean);
  const neg = [r.fatigue > 60 && 'Fatigue accumulée', r.injured && 'Blessure en cours', r.role === 'Équipier' && r.level >= 66 && 'Souhaite un rôle plus important'].filter(Boolean);
  const q = '<span class="muted">?</span>', hid = '<div class="muted">Informations masquées : observez ce coureur (notes à 50 %, potentiel à 75 %).</div>';
  const obsBox = own ? '' : `<div class="rbox"><div class="muted">Connaissance : ${kn}%</div><div class="meter"><i style="width:${kn}%"></i></div><div class="muted">${watching ? 'Observation en cours' : kn >= 100 ? 'Observation terminée' : 'Aucune observation en cours'} · ${used} active(s)</div>${kn >= 100 ? '' : `<button id="obs">${watching ? "Arrêter l'observation" : 'Observer ce coureur'}</button>`}</div>`;
  const row = ([code, label]) => `<div class="arow"><span><b>${code}</b> <span class="muted">${label}</span></span>
    <span>${known ? `<span class="tr ${trendOf(code, r)}">${{ up: '▲', down: '▼', flat: '►' }[trendOf(code, r)]}</span><span class="an ${tone(A[code])}">${A[code]}</span>` : '<span class="an g0">?</span>'}</span></div>`;
  const card = (title, body) => `<div class="scard"><h5>${title}</h5>${body}</div>`;

  c.innerHTML = `
    <div class="crumb"><a data-back>Effectif</a> › Rapport de coureur</div>
    <div class="rhead">
      <div class="rav">${esc(r.first_name[0] + r.last_name[0])}</div>
      <div class="rid"><div class="rname">${esc(r.first_name)} ${esc(r.last_name)} <span class="bd blue">${num}</span> ${watchers.length ? `<span class="bd green obs">Observé<span class="obs-pop"><b>Observé par :</b>${watchers.map((n) => `<div>(Transfert - ${esc(n)})</div>`).join('')}</span></span>` : ''}</div>
        <div class="muted">${r.age} ans · ${flag(r.nationality)}</div>
        <div class="rbad"><span class="bd violet">${SPEC_NAMES[r.spec]}</span> <span class="bd spec">${esc(r.role)}</span>${r.u23 ? ' <span class="bd amber">Espoir U23</span>' : ''}${known && A.MTN >= 78 ? ' <span class="bd gold">Montagne max</span>' : ''}</div></div>
      <div class="rteam"><img src="${esc(logoSrc(team || { name: '?' }))}" alt=""><div><b>${esc(team ? team.official_name || team.name : 'Sans équipe')}</b><div class="muted">${esc(r.role)}</div></div></div>
      <div class="rbox"><div class="muted">Valeur · clause libératoire</div><b>${fmtEUR(r.value)} · ${fmtEUR(r.clause ?? Math.round((r.value * 1.5) / 1000) * 1000)}</b>
        <div class="muted">${known ? fmtEUR(r.contract_salary || 0) + ' / mois' : '?'} · fin ${r.contract_end_year ? '31/12/' + r.contract_end_year : '-'}</div></div>
      <div class="rbox"><div class="muted">Niveau actuel</div>${known ? stars(r.level) : q}<div class="muted">Potentiel</div>${deep ? stars(r.pot) : q}</div>
      ${obsBox}
    </div>
    <div class="rcols">
      ${ATTR_BLOCKS.map(([title, list]) => `<div class="panel"><h4>${title}</h4>${list.map(row).join('')}</div>`).join('')}
      <div class="panel"><h4>Infos</h4>
        <div class="stat-row"><span>Expérience<small>Capitaine de route, gestion du stress</small></span><b>${deep ? exp + ' / 20' : '?'}</b></div>
        <div class="stat-row"><span>Réputation<small>${deep ? rep + ' sur 5' : ''}</small></span><b>${deep ? REPUTATIONS[rep - 1] : '?'}</b></div>
        <div class="stat-row"><span>Personnalité</span><b>${deep ? esc(traits.join(', ')) : '?'}</b></div>
        <div class="stat-row"><span>Spécialité</span><b>${SPEC_NAMES[r.spec]}</b></div>
        <div class="legend"><span class="tr up">▲</span> progression <span class="tr flat">►</span> stable <span class="tr down">▼</span> déclin</div></div>
    </div>
    <div class="scards">
      ${card("État d'esprit", known ? `<div class="mo ${moodCls} big">${mood}</div><div class="muted">Points positifs ${pos.length} · négatifs ${neg.length}</div><small>${pos.concat(neg).map(esc).join('<br>')}</small>` : hid)}
      ${card('Condition physique', known ? `<div class="big">${r.form}%</div><div class="meter"><i style="width:${r.form}%"></i></div><div class="muted">Fatigue ${r.fatigue || 0}% · risque de sur-entraînement : ${risk}</div>${r.injured ? `<div class="down">${esc(r.injury_type || 'Blessé')} jusqu'au ${fmtShort(r.injured_until)}</div>` : ''}` : hid)}
      ${card('Entraînement', known ? `<div><b>${FOCUS[r.spec]}</b></div><div class="muted">Note du staff</div><span class="bd green">${note} / 10</span>` : hid)}
      ${card('Stats de la saison', `<table class="fm"><tr><th>Jours de course</th><th>Victoires</th><th>Podiums</th><th>Pts UCI</th></tr><tr><td>${st.days}</td><td>${st.wins}</td><td>${st.pods}</td><td>${st.pts}</td></tr></table>`)}
    </div>`;
  const ob = $('obs');
  if (ob) ob.onclick = async () => {
    ob.disabled = true;
    const { error } = await sb.rpc(watching ? 'stop_observation' : 'start_observation', { p_rider: r0.id });
    if (error) { toast(error.message); ob.disabled = false; return; }
    toast(watching ? 'Observation arrêtée.' : "Observation lancée : la connaissance progresse à chaque jour de jeu.");
    renderRider(c);
  };
  c.querySelector('[data-back]').onclick = () => step(-1);
}
