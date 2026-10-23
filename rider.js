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
  const g = state.game, mine = state.team.id, mineIds = myTeamIds();
  const { data: r0, error } = await sb.from('riders').select('*').eq('id', state.rid || '').maybeSingle();
  if (!r0) {
    c.innerHTML = `<div class="panel"><h4>Coureur introuvable</h4><div class="muted">${esc(error?.message || 'Aucun coureur sélectionné : revenez au tableau et cliquez sur un nom.')}</div><p><a class="rl" data-back>Retour</a></p></div>`;
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
  // Brouillard de guerre : notes à 50 % de connaissance, potentiel et détails à 75 %
  const own = mineIds.includes(r0.team_id), kn = own ? 100 : (sc.data?.knowledge ?? 0), known = kn >= 50, deep = kn >= 75, fq = scoutFactors(sk.data || []);
  const names = { ...Object.fromEntries((ai.data || []).map((x) => [x.id, x.name])), ...Object.fromEntries((tms.data || []).map((x) => [x.id, x.official_name || x.name])) };
  const watchers = (obs.data || []).filter((o) => o.observer_team_id !== mine).map((o) => names[o.observer_ai_id || o.observer_team_id] || 'Club');
  const watching = (obs.data || []).some((o) => o.observer_team_id === mine), used = (myObs.data || []).length;
  const st = { days: 0, wins: 0, pods: 0, pts: 0 };
  (res.data || []).filter((x) => String(x.races?.date || '').slice(0, 4) === String(g.season_year)).forEach((x) => { st.days++; if (x.position === 1) st.wins++; if (x.position <= 3) st.pods++; st.pts += x.uci_points || 0; });
  r.moral = moralOf(r);

  // Rachat de contrat : une seule valeur (clause saisie si elle existe, sinon valeur estimée). Libre, ou contrat finissant cette saison : 0 €
  const buyout = r.clause ?? r.value, freeAgent = !r0.team_id || (r.contract_end_year != null && r.contract_end_year <= g.season_year);
  const A = attrsOf(r), exp = Math.max(1, Math.min(20, Math.round((r.age - 18) * 0.9 + (hashN(r.id) % 3)))), rep = r.level < 55 ? 1 : r.level < 62 ? 2 : r.level < 68 ? 3 : r.level < 72 ? 4 : 5;
  const t1 = hashN(r.id) % 7, t2 = (hashN(r.id + 'b') >>> 3) % 7, traits = [TRAITS[t1], t2 !== t1 ? TRAITS[t2] : null].filter(Boolean);
  const [mood, moodCls] = moralLabel(r.moral), team = r0.teams, num = (hashN(r.id) % 98) + 1;
  const note = Math.max(5, Math.min(9.9, 6 + (hashN(r.id + 'n') % 40) / 10 + (r.level - 55) / 20)).toFixed(2).replace('.', ',');
  const risk = r.fatigue > 70 || st.days > 40 ? 'Élevé' : r.fatigue > 45 || st.days > 25 ? 'Modéré' : 'Faible';
  const pos = [r.fatigue <= 25 && 'Très bonne fraîcheur', r.role === 'Leader' && 'Rôle de leader reconnu', r.u23 && r.pot - r.level >= 8 && 'Belles perspectives de progression', r.contract_end_year >= g.season_year + 2 && 'Contrat sécurisé'].filter(Boolean);
  const neg = [r.fatigue > 60 && 'Fatigue accumulée', r.injured && 'Blessure en cours', r.role === 'Équipier' && r.level >= 66 && 'Souhaite un rôle plus important'].filter(Boolean);
  const q = '<span class="muted">?</span>', hid = '<div class="muted">Informations masquées : observez ce coureur (notes à 50 %, potentiel à 75 %).</div>';
  const obsBox = own ? '' : `<div class="rbox"><div class="muted">Connaissance : ${kn}%</div><div class="meter"><i style="width:${kn}%"></i></div><div class="muted">${watching ? 'Observation en cours' : kn >= 100 ? 'Observation terminée' : 'Aucune observation en cours'} · ${used} active(s)</div></div>`;
  // Menu « Actions » : une entrée = { label, act, off (grisée), sub (flèche) }. Pour une future action : ajoutez une ligne ici et un « else if » plus bas.
  const watched = !!wl.data, offerOpen = (ofr.data || []).length > 0;
  const ACTIONS = own ? [] : [
    { label: watching ? 'Observation en cours' : kn >= 100 ? 'Observation terminée' : 'Observer ce coureur', act: 'observe', off: watching || kn >= 100 },
    ...(watching ? [{ label: "Arrêter l'observation", act: 'stopobs' }] : []),
    { label: offerOpen ? 'Offre en cours (voir)' : 'Faire une offre', act: 'offer' },
    { label: watched ? 'Retirer de la liste de sélection' : 'Ajouter à la liste de sélection', act: 'watch' },
    { sep: true },
    { label: 'Transfert', off: true, sub: true },
    { label: 'Rapport', off: true, sub: true },
    { label: 'Divers', off: true, sub: true },
  ];
  const actionsMenu = !ACTIONS.length ? '' : `<div class="actmenu"><button type="button" class="actbtn" id="actbtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg>Actions <span class="chev">&#9662;</span></button>
    <div class="actlist" id="actlist" hidden>${ACTIONS.map((a) => (a.sep ? '<hr>' : `<button type="button" class="actitem" data-act="${a.act || ''}" ${a.off ? 'disabled' : ''}>${a.label}${a.sub ? '<span class="chev">&#8250;</span>' : ''}</button>`)).join('')}</div></div>`;
  const attrCell = (code) => {
    if (own || kn >= 100) return `<span class="tr ${trendOf(code, r)}">${{ up: '▲', down: '▼', flat: '►' }[trendOf(code, r)]}</span><span class="an ${tone(A[code])}">${A[code]}</span>`;
    if (kn >= 20) { const [lo, hi] = attrRange(A[code], r.id, code, kn, fq.ca); return `<span class="an g0">${lo}-${hi}</span>`; }
    return '<span class="an g0">?</span>';
  };
  const row = ([code, label]) => `<div class="arow"><span><b>${code}</b> <span class="muted">${label}</span></span><span>${attrCell(code)}</span></div>`;
  const card = (title, body) => `<div class="scard"><h5>${title}</h5>${body}</div>`;
  const langHTML = mineIds.includes(r0.team_id) ? (await ensureStaffCtx(), riderLangHTML(r0)) : `<div class="stat-row"><span>Langues parlées</span><b>${known ? esc(siLangs(r0).map(siLabel).join(', ')) : '?'}</b></div>`;
 
  c.innerHTML = `
    <div class="crumb"><a data-back>Effectif</a> › Rapport de coureur</div>
    <div class="rhead">
            ${avatarWithEdit(r, 'rider')}
      <div class="rid"><div class="rname">${esc(r.first_name)} ${esc(r.last_name)} <span class="bd blue">${num}</span> ${watchers.length ? `<span class="bd green obs">Observé<span class="obs-pop"><b>Observé par :</b>${watchers.map((n) => `<div>(Transfert - ${esc(n)})</div>`).join('')}</span></span>` : ''}</div>
        <div class="muted">${r.age} ans · ${flag(r.nationality)}</div>
        <div class="rbad"><span class="bd violet">${SPEC_NAMES[r.spec]}</span> <span class="bd spec">${esc(r.role)}</span>${r.u23 ? ' <span class="bd amber">Espoir U23</span>' : ''}${known && A.MTN >= 78 ? ' <span class="bd gold">Montagne max</span>' : ''}</div>${actionsMenu}</div>
      <div class="rteam"><img src="${esc(logoSrc(team || { name: '?' }))}" alt=""><div><b>${esc(team ? team.official_name || team.name : 'Sans équipe')}</b><div class="muted">${esc(r.role)}</div></div></div>
      <div class="rbox"><div class="muted">Valeur estimée / Rachat :</div><b>${freeAgent ? 'Libre de tout contrat (0 €)' : moneyFog(buyout, r.id, 'clause', kn, own)}</b>
        <div class="muted">${known ? moneyFog(r.contract_salary || 0, r.id, 'salary', kn, own) + ' / mois' : '?'} · fin ${r.contract_end_year ? '31/12/' + r.contract_end_year : '-'}</div></div>
      <div class="rbox"><div class="muted">Niveau actuel</div>${levelStars(r, kn, own, fq)}<div class="muted">Potentiel</div>${potStars(r, kn, own, fq)}</div>
      ${obsBox}
    </div>
    <div class="rcols">
      ${ATTR_BLOCKS.map(([title, list]) => `<div class="panel"><h4>${title}</h4>${list.map(row).join('')}</div>`).join('')}
      <div class="panel"><h4>Infos</h4>
        <div class="stat-row"><span>Expérience<small>Capitaine de route, gestion du stress</small></span><b>${deep ? exp + ' / 20' : '?'}</b></div>
        <div class="stat-row"><span>Réputation<small>${deep ? rep + ' sur 5' : ''}</small></span><b>${deep ? REPUTATIONS[rep - 1] : '?'}</b></div>
        <div class="stat-row"><span>Personnalité</span><b>${deep ? esc(traits.join(', ')) : '?'}</b></div>
        <div class="stat-row"><span>Spécialité</span><b>${SPEC_NAMES[r.spec]}</b></div>
        ${langHTML}<div class="legend"><span class="tr up">▲</span> progression <span class="tr flat">►</span> stable <span class="tr down">▼</span> déclin</div></div>
    </div>
    <div class="scards">
      ${card("État d'esprit", known ? `<div class="mo ${moodCls} big">${mood}</div><div class="muted">Points positifs ${pos.length} · négatifs ${neg.length}</div><small>${pos.concat(neg).map(esc).join('<br>')}</small>` : hid)}
      ${card('Condition physique', known ? `<div class="big">${r.form}%</div><div class="meter"><i style="width:${r.form}%"></i></div><div class="muted">Fatigue ${r.fatigue || 0}% · risque de sur-entraînement : ${risk}</div>${r.injured ? `<div class="down">${esc(r.injury_type || 'Blessé')} jusqu'au ${fmtShort(r.injured_until)}</div>` : ''}` : hid)}
      ${card('Entraînement', known ? `<div><b>${FOCUS[r.spec]}</b></div><div class="muted">Note du staff</div><span class="bd green">${note} / 10</span>` : hid)}
      ${card('Stats de la saison', `<table class="fm"><tr><th>Jours de course</th><th>Victoires</th><th>Podiums</th><th>Pts UCI</th></tr><tr><td>${st.days}</td><td>${st.wins}</td><td>${st.pods}</td><td>${st.pts}</td></tr></table>`)}
    </div>`;
  const actBtn = $('actbtn'), actList = $('actlist');
  if (actBtn) {
    actBtn.onclick = (e) => { e.stopPropagation(); actList.hidden = !actList.hidden; };
    actList.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      actList.hidden = true;
      const rpc = async (fn, ok) => { const { error } = await sb.rpc(fn, { p_rider: r0.id }); if (error) return toast(error.message); toast(ok); renderRider(c); };
      if (b.dataset.act === 'observe') rpc('start_observation', 'Observation lancée : la connaissance progresse à chaque jour de jeu.');
      else if (b.dataset.act === 'stopobs') rpc('stop_observation', 'Observation arrêtée.');
      else if (b.dataset.act === 'offer') { if (typeof openNegotiationModal === 'function') openNegotiationModal(r0.id); else toast("Le module d'offre n'est pas chargé."); }
      else if (b.dataset.act === 'watch') {
        const { error } = await (watched ? sb.from('watchlist').delete().eq('team_id', mine).eq('rider_id', r0.id) : sb.from('watchlist').insert({ team_id: mine, rider_id: r0.id }));
        if (error) return toast(error.message);
        toast(watched ? 'Retiré de la liste de sélection.' : 'Ajouté à la liste de sélection.'); renderRider(c);
      }
    };
  }
  if (!window.actBound) {   // referme le menu « Actions » au clic ailleurs ou avec Échap
    window.actBound = true;
    document.addEventListener('click', (e) => { if (!e.target.closest('.actmenu')) document.querySelectorAll('.actlist').forEach((l) => (l.hidden = true)); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.actlist').forEach((l) => (l.hidden = true)); });
  }
  c.querySelector('[data-back]').onclick = () => step(-1);
}
