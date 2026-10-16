// rider.js — Fiche coureur (utilise sb, state, esc, fmtEUR, fmtShort, go, logoSrc, enrich, flag, SPEC_NAMES, moralOf, moralLabel)
const hashN = (s) => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
const ATTR_BLOCKS = [
  ['Aptitudes en course', [['MTN', 'Montagne'], ['MM', 'Moyenne montagne'], ['HIL', 'Vallons'], ['FLA', 'Plaine'], ['COB', 'Pavés'], ['SPR', 'Sprint'], ['ACC', 'Accélération'], ['TTR', 'Contre-la-montre'], ['PRL', 'Prologue']]],
  ['Physiologie', [['DHI', 'Descente'], ['ATT', 'Attaque'], ['STA', 'Endurance'], ['RES', 'Résistance'], ['REC', 'Récupération']]],
];
const PHYS = ['MTN', 'MM', 'HIL', 'SPR', 'ACC', 'ATT', 'PRL', 'TTR'];
const TRAITS = ['Perfectionniste', 'Leader né', 'Inconstant', 'Guerrier / combatif', "Travailleur de l'ombre", 'Mercenaire', 'Ambitieux'];
const REPUTATIONS = ['Locale', 'Nationale', 'Continentale', 'Internationale', 'Légende du peloton'];
const FOCUS = { MTN: 'Spécifique montagne', VAL: 'Vallons et puncheurs', CLM: 'Contre-la-montre', SPR: 'Trains de sprint', FLA: 'Pavés et flandriennes', PST: 'Polyvalence', EQP: 'Endurance de base' };

// Rendu des étoiles sur 6 maximum
function render6Stars(val) {
  const score = Math.max(0, Math.min(100, val || 50));
  const starsCount = Math.round((score / 100) * 6 * 2) / 2;
  let html = '';
  for (let i = 1; i <= 6; i++) {
    if (starsCount >= i) html += '★';
    else if (starsCount >= i - 0.5) html += '½';
    else html += '☆';
  }
  return `<span class="stars" style="color: #f59e0b; font-size: 1.1em;" title="${score}/100">${html}</span>`;
}

function attrsOf(r) {
  if (r.mtn != null) return { MTN: r.mtn, MM: r.mm, HIL: r.hil, FLA: r.fla, COB: r.cob, SPR: r.spr, ACC: r.acc, TTR: r.ttr, PRL: r.prl, DHI: r.dhi, ATT: r.att, STA: r.sta, RES: r.res, REC: r.rec };
  const v = (k) => r[k] || 0, avg = (...a) => a.reduce((x, y) => x + y, 0) / a.length, off = (c) => (hashN(r.id + c) % 5) - 2;
  const raw = { MTN: v('mountain'), MM: avg(v('mountain'), v('hills')), HIL: v('hills'), FLA: v('flat'), COB: v('cobbles'), SPR: v('sprint'),
    ACC: avg(v('sprint'), v('hills')) + off('ACC'), TTR: v('time_trial'), PRL: avg(v('time_trial'), v('sprint')) + off('PRL'),
    DHI: avg(v('hills'), v('cobbles')) + off('DHI'), ATT: avg(v('hills'), v('sprint'), v('mountain')) + off('ATT'),
    STA: v('stamina'), RES: avg(v('stamina'), v('recovery')) + off('RES'), REC: v('recovery') };
  return Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, Math.max(50, Math.min(85, Math.round(50 + ((x - 40) * 35) / 34)))]));
}

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
  const g = state.game, mine = state.team.id, mineIds = myTeamIds();
  const { data: r0, error } = await sb.from('riders').select('*').eq('id', state.rid || '').maybeSingle();
  if (!r0) {
    c.innerHTML = `<div class="panel"><h4>Coureur introuvable</h4><div class="muted">${esc(error?.message || 'Aucun coureur sélectionné.')}</div><p><a class="rl" data-back>Retour</a></p></div>`;
    c.querySelector('[data-back]').onclick = () => step(-1); return;
  }
  r0.teams = r0.team_id ? (await sb.from('teams').select('*').eq('id', r0.team_id).maybeSingle()).data : null;
  const [mates, res, sc, obs, ai, tms, myObs, sk, wl, ofr] = await Promise.all([
    r0.team_id ? sb.from('riders').select('*').eq('team_id', r0.team_id) : Promise.resolve({ data: [r0] }),
    sb.from('race_results').select('position, uci_points, races(date)').eq('rider_id', r0.id),
    mineIds.includes(r0.team_id) ? Promise.resolve({ data: null }) : sb.from('scouting_reports').select('knowledge').eq('team_id', mine).eq('rider_id', r0.id).maybeSingle(),
    sb.from('rider_observations').select('observer_ai_id, observer_team_id').eq('rider_id', r0.id),
    sb.from('ai_clubs').select('id, name'),
    sb.from('teams').select('id, name, official_name'),
    sb.from('rider_observations').select('rider_id').eq('observer_team_id', mine),
    sb.from('scouts').select('*').eq('team_id', mine),
    sb.from('watchlist').select('rider_id').eq('team_id', mine).eq('rider_id', r0.id).maybeSingle(),
    sb.from('transfer_offers').select('id').eq('from_team_id', mine).eq('rider_id', r0.id).in('status', ['PENDING_CLUB', 'CLUB_ACCEPTED', 'NEGOTIATING_CONTRACT', 'CONTRACT_ACCEPTED']).limit(1),
  ]);
  const r = enrich(mates.data || [r0], g.game_date).find((x) => x.id === r0.id);
  const own = mineIds.includes(r0.team_id), kn = own ? 100 : (sc.data?.knowledge ?? 0), known = kn >= 50, deep = kn >= 75, fq = scoutFactors(sk.data || []);
  const names = { ...Object.fromEntries((ai.data || []).map((x) => [x.id, x.name])), ...Object.fromEntries((tms.data || []).map((x) => [x.id, x.official_name || x.name])) };
  
  // Filtrage strict pour ne garder que les vrais clubs existants
  const watchers = (obs.data || []).filter((o) => o.observer_team_id !== mine).map((o) => names[o.observer_ai_id || o.observer_team_id]).filter(Boolean);
  
  const watching = (obs.data || []).some((o) => o.observer_team_id === mine), used = (myObs.data || []).length;
  const st = { days: 0, wins: 0, pods: 0, pts: 0 };
  (res.data || []).filter((x) => String(x.races?.date || '').slice(0, 4) === String(g.season_year)).forEach((x) => { st.days++; if (x.position === 1) st.wins++; if (x.position <= 3) st.pods++; st.pts += x.uci_points || 0; });
  r.moral = moralOf(r);

  const buyout = r.clause ?? r.value, freeAgent = !r0.team_id || (r.contract_end_year != null && r.contract_end_year <= g.season_year);
  const A = attrsOf(r), exp = Math.max(1, Math.min(20, Math.round((r.age - 18) * 0.9 + (hashN(r.id) % 3)))), rep = r.level < 55 ? 1 : r.level < 62 ? 2 : r.level < 68 ? 3 : r.level < 72 ? 4 : 5;
  const t1 = hashN(r.id) % 7, t2 = (hashN(r.id + 'b') >>> 3) % 7, traits = [TRAITS[t1], t2 !== t1 ? TRAITS[t2] : null].filter(Boolean);
  const [mood, moodCls] = moralLabel(r.moral), team = r0.teams, num = (hashN(r.id) % 98) + 1;
  const note = Math.max(5, Math.min(9.9, 6 + (hashN(r.id + 'n') % 40) / 10 + (r.level - 55) / 20)).toFixed(2).replace('.', ',');
  const risk = r.fatigue > 70 || st.days > 40 ? 'Élevé' : r.fatigue > 45 || st.days > 25 ? 'Modéré' : 'Faible';
  const pos = [r.fatigue <= 25 && 'Très bonne fraîcheur', r.role === 'Leader' && 'Rôle de leader reconnu', r.u23 && r.pot - r.level >= 8 && 'Belles perspectives de progression', r.contract_end_year >= g.season_year + 2 && 'Contrat sécurisé'].filter(Boolean);
  const neg = [r.fatigue > 60 && 'Fatigue accumulée', r.injured && 'Blessure en cours', r.role === 'Équipier' && r.level >= 66 && 'Souhaite un rôle plus important'].filter(Boolean);
  const hid = '<div class="muted">Informations masquées : observez ce coureur.</div>';
  const obsBox = own ? '' : `<div class="rbox"><div class="muted">Connaissance : ${kn}%</div><div class="meter"><i style="width:${kn}%"></i></div><div class="muted">${watching ? 'Observation en cours' : kn >= 100 ? 'Observation terminée' : 'Aucune observation'} · ${used} active(s)</div></div>`;
  const watched = !!wl.data, offerOpen = (ofr.data || []).length > 0;
  
  const ACTIONS = own ? [] : [
    { label: watching ? 'Observation en cours' : kn >= 100 ? 'Observation terminée' : 'Observer ce coureur', act: 'observe', off: watching || kn >= 100 },
    ...(watching ? [{ label: "Arrêter l'observation", act: 'stopobs' }] : []),
    { label: offerOpen ? 'Offre en cours (voir)' : 'Faire une offre', act: 'offer' },
    { label: watched ? 'Retirer de la liste' : 'Ajouter à la liste', act: 'watch' },
  ];
  const actionsMenu = !ACTIONS.length ? '' : `<div class="actmenu"><button type="button" class="actbtn" id="actbtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg>Actions <span class="chev">&#9662;</span></button><div class="actlist" id="actlist" hidden>${ACTIONS.map((a) => `<button type="button" class="actitem" data-act="${a.act || ''}" ${a.off ? 'disabled' : ''}>${a.label}</button>`).join('')}</div></div>`;
  
  const attrCell = (code) => {
    if (own || kn >= 100) return `<span class="tr ${trendOf(code, r)}">${{ up: '▲', down: '▼', flat: '►' }[trendOf(code, r)]}</span><span class="an ${tone(A[code])}">${A[code]}</span>`;
    if (kn >= 20) { const [lo, hi] = attrRange(A[code], r.id, code, kn, fq.ca); return `<span class="an g0">${lo}-${hi}</span>`; }
    return '<span class="an g0">?</span>';
  };
  const row = ([code, label]) => `<div class="arow"><span><b>${code}</b> <span class="muted">${label}</span></span><span>${attrCell(code)}</span></div>`;
  const card = (title, body) => `<div class="scard"><h5>${title}</h5>${body}</div>`;

  c.innerHTML = `
    <div class="crumb"><a data-back>Effectif</a> › Rapport de coureur</div>
    <div class="rhead">
      <div class="rav">${esc(r.first_name[0] + r.last_name[0])}</div>
      <div class="rid"><div class="rname">${esc(r.first_name)} ${esc(r.last_name)} <span class="bd blue">${num}</span> ${watchers.length ? `<span class="bd green obs">Observé<span class="obs-pop"><b>Observé par :</b>${watchers.map((n) => `<div>(${esc(n)})</div>`).join('')}</span></span>` : ''}</div>
        <div class="muted">${r.age} ans · ${flag(r.nationality)}</div>
        <div class="rbad"><span class="bd violet">${SPEC_NAMES[r.spec]}</span> <span class="bd spec">${esc(r.role)}</span>${r.u23 ? ' <span class="bd amber">Espoir U23</span>' : ''}</div>${actionsMenu}</div>
      <div class="rteam"><img src="${esc(logoSrc(team || { name: '?' }))}" alt=""><div><b>${esc(team ? team.official_name || team.name : 'Sans équipe')}</b><div class="muted">${esc(r.role)}</div></div></div>
      <div class="rbox"><div class="muted">Valeur estimée / Rachat :</div><b>${freeAgent ? 'Libre (0 €)' : moneyFog(buyout, r.id, 'clause', kn, own)}</b>
        <div class="muted">${known ? moneyFog(r.contract_salary || 0, r.id, 'salary', kn, own) + ' / mois' : '?'} · fin ${r.contract_end_year ? '31/12/' + r.contract_end_year : '-'}</div></div>
      <div class="rbox"><div class="muted">Niveau actuel</div>${render6Stars(r.level)}<div class="muted">Potentiel</div>${render6Stars(r.pot || r.level)}</div>
      ${obsBox}
    </div>
    <div class="rcols">
      ${ATTR_BLOCKS.map(([title, list]) => `<div class="panel"><h4>${title}</h4>${list.map(row).join('')}</div>`).join('')}
      <div class="panel"><h4>Infos</h4>
        <div class="stat-row"><span>Expérience</span><b>${deep ? exp + ' / 20' : '?'}</b></div>
        <div class="stat-row"><span>Réputation</span><b>${deep ? REPUTATIONS[rep - 1] : '?'}</b></div>
        <div class="stat-row"><span>Personnalité</span><b>${deep ? esc(traits.join(', ')) : '?'}</b></div></div>
    </div>
    <div class="scards">
      ${card("État d'esprit", known ? `<div class="mo ${moodCls} big">${mood}</div><div class="muted">Points positifs ${pos.length} · négatifs ${neg.length}</div><small>${pos.concat(neg).map(esc).join('<br>')}</small>` : hid)}
      ${card('Condition physique', known ? `<div class="big">${r.form}%</div><div class="meter"><i style="width:${r.form}%"></i></div><div class="muted">Fatigue ${r.fatigue \vert{}\vert{} 0}\% · risque : ${risk}</div>` : hid)}
      ${card('Entraînement', known ? `<div><b>${FOCUS[r.spec]}</b></div><div class="muted">Note staff</div><span class="bd green">${note} / 10</span>` : hid)}
      ${card('Stats saison', `<table class="fm"><tr><th>Jours</th><th>Victoires</th><th>Podiums</th><th>Pts</th></tr><tr><td>${st.days}</td><td>${st.wins}</td><td>${st.pods}</td><td>${st.pts}</td></tr></table>`)}
    </div>`;

  const actBtn = $('actbtn'), actList =$('actlist');
  if (actBtn) {
    actBtn.onclick = (e) => { e.stopPropagation(); actList.hidden = !actList.hidden; };
    actList.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      actList.hidden = true;
      const rpc = async (fn, ok) => { const { error } = await sb.rpc(fn, { p_rider: r0.id }); if (error) return toast(error.message); toast(ok); renderRider(c); };
      if (b.dataset.act === 'observe') rpc('start_observation', 'Observation lancée.');
      else if (b.dataset.act === 'stopobs') rpc('stop_observation', 'Observation arrêtée.');
      else if (b.dataset.act === 'offer') { if (typeof openNegotiationModal === 'function') openNegotiationModal(r0.id); else toast("Module d'offre absent."); }
      else if (b.dataset.act === 'watch') {
        const { error } = await (watched ? sb.from('watchlist').delete().eq('team_id', mine).eq('rider_id', r0.id) : sb.from('watchlist').insert({ team_id: mine, rider_id: r0.id }));
        if (error) return toast(error.message);
        toast(watched ? 'Retiré de la liste.' : 'Ajouté à la liste.'); renderRider(c);
      }
    };
  }
  c.querySelector('[data-back]').onclick = () => step(-1);
}
