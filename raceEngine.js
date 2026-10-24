// raceEngine.js — moteur physico-tactique de course (à charger APRÈS sim.js)
// Utilise sim.js (profileAlt, simRng, simGap, SIM_GROUP, generateRaceProfile, mountRaceProfile), squad.js (enrich), app.js (sb, state, esc, $, toast, PROFILES, selHtml, calculateStaffImpact, loadStaffImpactCtx)
const RE = { BASE: 60, DT: 10, PLACES: { FRONT: 'Avant', MID: 'Milieu', BACK: 'Arrière' }, SHELTER: { FRONT: 1, MID: 0.7, BACK: 0.65 } };   // BASE : secondes de course par seconde réelle à x1 ; abri dans la roue : -30 % d'effort
const reClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reClock = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}'${String(Math.floor(s % 60)).padStart(2, '0')}"`;
const reSlope = (P, km) => ((profileAlt(P, km + 0.1) - profileAlt(P, Math.max(0, km - 0.1))) / 200) * 100;                       // pente en %
const reZone = (P, km) => ({ cobble: P.cobbles.some((c) => km >= c.from && km <= c.to), wind: P.wind.find((w) => km >= w.from && km <= w.to) || null, feed: P.feeds.findIndex((f) => km >= f.from && km <= f.to) });
const reAhead = (P, km) => P.km - km < 6 || P.cobbles.some((c) => c.from > km && c.from - km < 4) || P.wind.some((w) => w.from > km && w.from - km < 4) || P.climbs.some((c) => c.start > km && c.start - km < 2);
const reLeadKm = (S) => { const k = S.groups.filter((g) => !g.finished && g.riders.length).map((g) => g.km); return k.length ? Math.max(...k) : S.profile.km; };
function reLog(S, text, mine = false) { S.log.push({ t: S.t, km: reLeadKm(S), text, mine }); if (S.log.length > 250) S.log.shift(); }

// Vitesse soutenable du coureur selon la pente (puissance en W/kg), l'aérodynamisme, les pavés, la fatigue, la fringale et sa forme
function reCap(r, slope, zone) {
  const s = Math.max(0, slope), st = s >= 5 ? r.mountain : s >= 2.5 ? (r.mountain + r.hills) / 2 : r.hills, wkg = 4.6 + (st - 50) * 0.06;
  const aero = 44 + (r.flat - 50) * 0.2 + (zone.cobble ? (r.cobbles - 60) * 0.1 - 6 : 0);
  const v = slope < 0 ? aero + Math.min(32, -slope * 3.6) : 1 / (1 / ((3.6 * wkg) / (9.81 * (s / 100 + 0.005))) + 1 / (aero * (1 + 0.35 * s)));
  return v * (0.55 + (0.45 * r.stam) / 100) * (r.gly < 10 ? 0.6 : r.gly < 25 ? 0.85 : 1) * (r.boost || 1);
}

function reNewGroup(S, type, km, rs, tempo) {
  const g = { id: 'g' + S.nid++, type, km, v: 0, tempo, riders: rs.map((r) => r.id), gap: 0, born: S.t, finished: false };
  rs.forEach((r) => { r.group = g.id; r.drop = false; r.slip = 0; r.status = 'RACE'; }); S.groups.push(g); return g;
}
function reSplit(S, g, rs, type, tempo, text, offset = 0.12) {
  const ids = new Set(rs.map((r) => r.id)); g.riders = g.riders.filter((i) => !ids.has(i));
  const ng = reNewGroup(S, type, g.km - offset, rs, tempo); reLog(S, text, rs.some((r) => r.mine)); return ng;
}
function reMerge(S, a, b) {
  const bigger = a.riders.length >= b.riders.length ? a.type : b.type, brk = a.type === 'BREAK' || b.type === 'BREAK', n = b.riders.length;
  b.riders.forEach((id) => (S.riders[id].group = a.id)); a.riders.push(...b.riders); b.riders = [];
  a.type = a.type === 'PELOTON' || b.type === 'PELOTON' ? 'PELOTON' : bigger;
  if (brk) reLog(S, "Jonction : l'échappée est reprise.", S.riders[a.riders[0]]?.mine); else if (n >= 3) reLog(S, `Jonction : ${n} coureurs rentrent dans le groupe.`);
}
function reAutoPlace(S, g, act) {   // placement : les meilleurs se placent à l'avant avant les bordures, pavés, cols et dans les 6 derniers km
  const rank = [...act].sort((a, b) => b.level - a.level), sector = reAhead(S.profile, g.km);
  rank.forEach((r, i) => {
    if (r.order) { r.place = r.order; return; }
    const p = i / rank.length, want = sector ? (p < 0.35 ? 'FRONT' : p < 0.75 ? 'MID' : 'BACK') : p < 0.12 ? 'FRONT' : p < 0.85 ? 'MID' : 'BACK';
    if (want !== r.place) { r.place = want; if (want === 'FRONT') r.atk = Math.max(0, r.atk - 0.4); }
  });
}

function createRaceState(race, profile, field, car = 0) {
  const rng = simRng(String(race.id) + ':' + Date.now());
  const riders = Object.fromEntries(field.map((r) => [r.id, { ...r, status: 'RACE', place: 'MID', group: 'g0', km: 0, atk: 100, gly: 100, bottles: 2, slip: 0, order: null, fed: [], drop: false }]));
  const S = { race, profile, rng, t: 0, speed: 0, acc: 0, tick: 0, riders, log: [], results: [], done: false, nid: 1, car, breakDone: false,
    temp: Math.round(8 + rng() * 18), order: null, wind: 15 + rng() * 25, head: (rng() - 0.5) * 8, wet: rng() < 0.12, groups: [{ id: 'g0', type: 'PELOTON', km: 0, v: 0, tempo: 0.92, riders: field.map((r) => r.id), gap: 0, born: 0, finished: false }] };
  reLog(S, `Départ de ${race.name} : ${field.length} coureurs, ${profile.km} km${S.wet ? ', route mouillée' : ''}.`); return S;
}
const reAdvance = (S, simSeconds) => { S.acc += simSeconds; while (S.acc >= RE.DT && !S.done) { reStep(S, RE.DT); S.acc -= RE.DT; } };                // boucle de tick
const reSkipToFinal = (S) => { let n = 0; while (!S.done && reLeadKm(S) < S.profile.km - 1 && n++ < 9000) reStep(S, RE.DT); };                    // saut jusqu'au km final

function reStep(S, dt = RE.DT) {
  const P = S.profile, total = P.km; S.t += dt;
  if (S.order && S.t > S.order.until) {   // fin d'une consigne collective
    Object.values(S.riders).forEach((r) => { if (r.ordered) { r.order = null; r.ordered = false; } });
    reLog(S, `Fin de la consigne « ${RE_ORDERS[S.order.id]} ».`, true); S.order = null;
  }
  for (const g of [...S.groups]) {
    if (g.finished || !g.riders.length) continue;
    const act = g.riders.map((id) => S.riders[id]).filter((r) => r.status === 'RACE'); if (!act.length) continue;
    const slope = reSlope(P, g.km), zone = reZone(P, g.km), left = total - g.km;
    if (g.type === 'DROPPED') {   // chasse-patate : les lâchés encore frais forcent pour rentrer
      const was = g.chase, st = act.reduce((a, r) => a + r.stam, 0) / act.length, ak = act.reduce((a, r) => a + r.atk, 0) / act.length;
      g.chase = g.gap < 300 && st > 25 && ak > 35;
      if (g.chase && !was) reLog(S, `Chasse-patate : ${act.length} coureur(s) lâché(s) tentent de rentrer (${simGap(g.gap)}).`, act.some((r) => r.mine));
      act.filter((r) => r.stam < 2 || g.gap > 1800).forEach((r) => { r.status = 'DNF'; g.riders = g.riders.filter((i) => i !== r.id); reLog(S, `Abandon de ${r.name} (${r.team}).`, r.mine); });
    }
    const caps = act.map((r) => reCap(r, slope, zone)).sort((a, b) => b - a), top = caps.slice(0, Math.max(1, Math.ceil(act.length * 0.4))), motor = top.reduce((a, b) => a + b, 0) / top.length;
    const chasing = g.type === 'PELOTON' && S.groups.some((x) => x.type === 'BREAK' && !x.finished && x.riders.length) && g.gap >= 15 && g.gap <= 420;
    g.tempo = g.type === 'PELOTON' ? (chasing ? 0.975 : left < 30 ? 1 : 0.92) : g.type === 'BREAK' ? 0.99 : g.type === 'CHASE' ? 1 : g.chase ? 1.03 : 0.88;
    if (g.type === 'PELOTON' && S.order?.id === 'TEMPO' && S.t <= S.order.until && act.filter((r) => r.mine && r.place === 'FRONT').length >= 2) g.tempo = Math.max(g.tempo, 0.965);
    const v = reClamp(motor * g.tempo * (zone.wind ? 0.985 : 1) * (1 - S.head * 0.004), 8, 82); g.v = v; g.km += (v * dt) / 3600;
    if (Math.round(S.t / dt) % 6 === 0) reAutoPlace(S, g, act);

    for (const r of act) {   // effort (pente, vent, abri) → stamina, énergie d'attaque, hydratation / glycogène
      const cap = reCap(r, slope, zone), sh = 1 - (1 - RE.SHELTER[r.place]) * (slope > 6 ? 0.35 : 1), eff = (v / cap) ** 2 * sh * (g.chase ? 1.1 : 1) * reOrderEff(S, r, g);
      r.stam = reClamp(r.stam - (0.33 * eff ** 2.2 * (1.3 - r.stamina / 200) * dt) / 60 + (eff < 0.6 ? ((0.6 - eff) * 0.35 * (r.recovery / 60) * dt) / 60 : 0), 0, 100);
      if (eff > 1.05) r.atk = Math.max(0, r.atk - ((eff - 1.05) * 1.6 * dt) / 10); else if (eff < 0.9) r.atk = Math.min(100, r.atk + (0.05 * (r.recovery / 60) * dt) / 10);
      r.gly = Math.max(0, r.gly - ((0.2 + 0.18 * eff) * dt) / 60);
      if (r.gly < 60 && r.bottles > 0) { r.bottles--; r.gly = Math.min(100, r.gly + 22); }                                  // il boit un bidon
      if (zone.feed >= 0 && !r.fed.includes(zone.feed)) { r.fed.push(zone.feed); r.bottles = Math.min(3, r.bottles + 1); }   // zone de ravitaillement : musette
      if (r.gly < 8 && !r.bonk) { r.bonk = true; reLog(S, `Fringale pour ${r.name} (${r.team}).`, r.mine); } else if (r.gly > 30) r.bonk = false;
      r.slip = eff > 1.2 ? r.slip + (eff - 1.2) * dt * 2 : Math.max(0, r.slip - dt * 0.5);
      if (r.slip > 40 || r.stam < 5) r.drop = true;
    }
    const out = act.filter((r) => r.drop);   // cassure : coureurs lâchés
    if (out.length) reSplit(S, g, out, 'DROPPED', 0.88, `${out.length} coureur(s) lâché(s) : ${out.slice(0, 3).map((r) => r.name).join(', ')}${out.length > 3 ? '…' : ''}.`);
    const rest = act.filter((r) => !r.drop);
    if (zone.wind && v >= 43 && rest.length >= 8) {   // bordures : le vent de côté coupe l'arrière du groupe (plus la vitesse est haute, plus le risque est fort)
      const cut = rest.filter((r) => S.rng() < (r.place === 'BACK' ? 0.05 : r.place === 'MID' ? 0.015 : 0) * (dt / 10) * ((v - 40) / 6));
      if (cut.length) reSplit(S, g, cut, 'CHASE', 1, `Bordures ! ${cut.length} coureur(s) pris en bordure (vent ${zone.wind.dir === 'L' ? 'de gauche' : 'de droite'}).`, 0.15);
    }
    for (const r of rest) {   // aléas : crevaisons (×5 sur les pavés), chutes (descentes, vent, route mouillée)
      if (r.group !== g.id || r.status !== 'RACE') continue;
      const f = (zone.cobble ? 5 : 1) * (S.wet ? 1.8 : 1);
      if (S.rng() < 3.6e-6 * dt * f * (1 - (r.wheels || 0))) reIncident(S, g, r, 'PUNCT', 40 + S.rng() * 50 - S.car * 8);
      else if (S.rng() < 2.2e-6 * dt * f * (zone.wind ? 1.5 : 1) * (slope < -4 ? 2 : 1) * (1 + act.length / 150)) reIncident(S, g, r, 'CRASH', 60 + S.rng() * 120);
    }
  }
  reSolos(S, dt); reAutoAttacks(S, dt);
  S.groups = S.groups.filter((g) => !g.finished && g.riders.length).sort((a, b) => b.km - a.km);
  for (let i = 0; i < S.groups.length; i++) for (let j = S.groups.length - 1; j > i; j--) {   // jonctions (délai de 90 s après une cassure)
    const a = S.groups[i], b = S.groups[j];
    if (b.riders.length && a.riders.length && a.km - b.km < 0.08 && S.t - b.born > 90) reMerge(S, a, b);
  }
  S.groups = S.groups.filter((g) => g.riders.length);
  const lead = reLeadKm(S); S.groups.forEach((g) => (g.gap = ((lead - g.km) / Math.max(20, g.v || 30)) * 3600));
  for (const g of S.groups) if (g.km >= total && !g.finished) reFinish(S, g);
  if (!S.groups.some((g) => !g.finished && g.riders.length) && !Object.values(S.riders).some((r) => ['RETURN', 'PUNCT', 'CRASH', 'CAR'].includes(r.status))) {
    S.done = true; reLog(S, 'Classement : ' + S.results.slice(0, 5).map((r) => `${r.pos}. ${r.name}`).join(' · '));
  }
}

function reIncident(S, g, r, kind, dur) {
  const hit = [r];
  if (kind === 'CRASH') g.riders.filter((i) => i !== r.id).forEach((i) => { const o = S.riders[i]; if (o.status === 'RACE' && hit.length < 4 && S.rng() < 0.04) hit.push(o); });
  hit.forEach((x) => {
    g.riders = g.riders.filter((i) => i !== x.id); x.group = null; x.km = g.km; x.until = S.t + Math.max(25, dur); x.status = kind;
    if (kind === 'CRASH') { x.stam = Math.max(0, x.stam - 12); if (S.rng() < 0.25) { x.status = 'DNF'; reLog(S, `Abandon sur chute de ${x.name} (${x.team}).`, x.mine); } }
  });
  reLog(S, kind === 'PUNCT' ? `Crevaison pour ${r.name} (${r.team}).` : `Chute : ${hit.map((x) => x.name).join(', ')}.`, hit.some((x) => x.mine));
}
function reSolos(S, dt) {   // coureurs hors groupe : crevaison / chute en cours, aller à la voiture, retour seul
  const P = S.profile;
  for (const r of Object.values(S.riders)) {
    if (r.status === 'PUNCT' || r.status === 'CRASH') { if (S.t >= r.until) r.status = 'RETURN'; continue; }
    if (r.status === 'CAR') { r.km += ((r.gv || 38) * 0.9 * dt) / 3600; if (S.t >= r.until) { reDeliver(S, r); r.status = 'RETURN'; } continue; }
    if (r.status !== 'RETURN') continue;
    const v = reCap(r, reSlope(P, r.km), reZone(P, r.km)) * 1.08; r.km += (v * dt) / 3600; r.alone = (r.alone || 0) + dt;
    r.stam = Math.max(0, r.stam - (0.33 * 1.2 ** 2.2 * (1.3 - r.stamina / 200) * dt) / 60); r.gly = Math.max(0, r.gly - (0.4 * dt) / 60);
    const g2 = S.groups.find((g) => !g.finished && g.riders.length && Math.abs(g.km - r.km) < 0.15);
    if (g2) { g2.riders.push(r.id); r.group = g2.id; r.status = 'RACE'; r.alone = 0; r.slip = 0; if (r.mine) reLog(S, `${r.name} est revenu dans le groupe.`, true); }
    else if (r.stam < 8 || r.alone > 900) { r.alone = 0; reNewGroup(S, 'DROPPED', r.km, [r], 0.88); }
  }
}
function reDeliver(S, r) {   // l'équipier ramène des bidons à ses coéquipiers
  const mates = (r.fetch || []).map((i) => S.riders[i]).filter((m) => m.status === 'RACE');
  mates.forEach((m) => (m.bottles = Math.min(3, m.bottles + 2))); r.bottles = 3; reLog(S, `${r.name} ramène des bidons à ${mates.length} coéquipier(s).`, true);
}
function reSendForBottles(S, id) {   // ordre : envoyer un équipier chercher des bidons à la voiture (durée réduite par la flotte de véhicules)
  const r = S.riders[id], g = S.groups.find((x) => x.id === r?.group);
  if (!r || r.status !== 'RACE' || !g) return 'Ce coureur ne peut pas aller à la voiture.';
  const mates = g.riders.filter((i) => i !== id && S.riders[i].mine && S.riders[i].status === 'RACE');
  if (!mates.length) return 'Aucun coéquipier à ravitailler dans ce groupe.';
  g.riders = g.riders.filter((i) => i !== id); Object.assign(r, { status: 'CAR', group: null, km: g.km, gv: g.v, fetch: mates, until: S.t + Math.max(45, 110 - S.car * 12) });
  reLog(S, `${r.name} redescend à la voiture chercher des bidons pour ${mates.length} coéquipier(s).`, true); return `${r.name} part chercher des bidons.`;
}

function reAttackIds(S, g, rs) {
  const ids = new Set(rs.map((r) => r.id)); g.riders = g.riders.filter((i) => !ids.has(i)); rs.forEach((r) => (r.atk = Math.max(0, r.atk - 15)));
  reNewGroup(S, 'BREAK', g.km + 0.12, rs, 0.99); S.breakDone = true;
  reLog(S, `Attaque de ${rs.map((r) => r.name).join(', ')} (${[...new Set(rs.map((r) => r.team))].join(', ')}).`, rs.some((r) => r.mine));
}
function reAttack(S, id) {   // ordre d'attaque d'un de vos coureurs
  const r = S.riders[id], g = S.groups.find((x) => x.id === r?.group);
  if (!r || r.status !== 'RACE' || !g) return 'Attaque impossible.';
  if (r.atk < 40) return `${r.name} manque d'énergie d'attaque (${Math.round(r.atk)} %).`;
  reAttackIds(S, g, [r]); return `${r.name} attaque !`;
}
function reAutoAttacks(S, dt) {   // attaques des équipes adverses : échappée du matin, côtes, fin de course
  const p = S.groups.find((g) => g.type === 'PELOTON' && !g.finished && g.riders.length); if (!p) return;
  const act = p.riders.map((id) => S.riders[id]).filter((r) => r.status === 'RACE' && !r.mine); if (act.length < 12) return;
  const slope = reSlope(S.profile, p.km), early = p.km > 4 && p.km < 35 && !S.breakDone, hot = (slope > 3 && slope < 9) || S.profile.km - p.km < 45;
  if (S.rng() >= (early ? 0.02 : hot ? 0.0015 : 0.0004) * (dt / 10)) return;
  const pick = act.filter((r) => r.atk > 60).map((r) => [r, r.atk + r.flat + r.mountain + S.rng() * 60]).sort((a, b) => b[1] - a[1]).slice(0, 1 + Math.floor(S.rng() * (early ? 5 : 3))).map((x) => x[0]);
  if (pick.length) reAttackIds(S, p, pick);
}
function reFinish(S, g) {   // sprint : sprint, énergie, stamina, placement
  const total = S.profile.km, act = g.riders.map((id) => S.riders[id]).filter((r) => r.status === 'RACE');
  const sc = (r) => r.sprint * (0.55 + (0.45 * r.atk) / 100) * (0.6 + (0.4 * r.stam) / 100) * { FRONT: 1.05, MID: 1, BACK: 0.92 }[r.place] * (S.order?.id === 'TRAIN' && r.id === S.order.leader ? 1.07 : 1) * (0.9 + 0.2 * S.rng());
  const t0 = S.t - ((g.km - total) / Math.max(g.v, 1)) * 3600; act.sort((a, b) => sc(b) - sc(a));
  act.forEach((r, i) => { r.status = 'FIN'; S.results.push({ id: r.id, name: r.name, team: r.team, mine: r.mine, pos: S.results.length + 1, time: Math.round(t0 + i * 0.1) }); });
  g.finished = true; g.riders = []; if (act[0]) reLog(S, `Arrivée : ${act[0].name} (${act[0].team}) s'impose${S.results.length === act.length ? '' : ' pour le groupe'}.`, act.some((r) => r.mine));
}

const reMake = (r, t, mine) => ({ id: r.id, photo_url: r.photo_url, photo_crop: r.photo_crop, name: `${r.first_name} ${r.last_name}`, team: t.official_name || t.name, teamId: t.id, mine, level: r.level, flat: r.flat || 60, mountain: r.mountain || 60,
  hills: r.hills || 60, time_trial: r.time_trial || 60, sprint: r.sprint || 60, cobbles: r.cobbles || 60, stamina: r.stamina || 60, recovery: r.recovery || 60, wheels: 0,
  stam: 100 - (r.fatigue || 0) * 0.4,   // forme et fatigue issues de l'entraînement ; bonus du staff (stratégie de course) pour votre équipe
  boost: reClamp((r.fitness ?? 70) / 70, 0.9, 1.08) * (mine && typeof calculateStaffImpact === 'function' ? calculateStaffImpact(state.team.id, r).raceBonus : 1) });

async function buildRaceField(race) {
  const myId = state.team.id;
  const [tm, rs, en, inf] = await Promise.all([
    sb.from('teams').select('id, name, official_name, category').neq('category', 'DEV'), sb.from('riders').select('*').not('team_id', 'is', null),
    sb.from('race_entries').select('id, team_id').eq('race_id', race.id), sb.from('team_infrastructures').select('type, level').eq('team_id', myId),
  ]);
  const ent = Object.fromEntries((en.data || []).map((e) => [e.id, e.team_id])), eids = (en.data || []).map((e) => e.id);
  const { data: er } = eids.length ? await sb.from('race_entry_riders').select('entry_id, rider_id').in('entry_id', eids) : { data: [] }, picked = {};
  (er || []).forEach((x) => (picked[ent[x.entry_id]] = picked[ent[x.entry_id]] || new Set()).add(x.rider_id));
  const rows = enrich(rs.data || [], state.game.game_date), riders = [];
  for (const t of tm.data || []) {
    const pool = rows.filter((r) => r.team_id === t.id).sort((a, b) => b.level - a.level), sel = picked[t.id]?.size ? pool.filter((r) => picked[t.id].has(r.id)) : pool.slice(0, 7);   // sans sélection : meilleurs coureurs
    sel.forEach((r) => riders.push(reMake(r, t, t.id === myId)));
  }
  const rng = simRng(String(race.id) + 'field'), teams = ['Alba', 'Borea', 'Cassini', 'Delta', 'Eolia', 'Fenix', 'Garona', 'Helios', 'Ivoire', 'Jura'], need = Math.max(0, 90 - riders.length);
  for (let i = 0; i < need; i++) {   // peloton complété par des coureurs fictifs
    const q = 52 + rng() * 22, f = (b) => reClamp(q + (rng() - 0.5) * b, 45, 82);
    riders.push({ id: 'f' + i, name: `Coureur ${i + 1}`, team: `Équipe ${teams[i % teams.length]}`, teamId: 'f', mine: false, level: q, flat: f(12), mountain: f(14), hills: f(12), time_trial: f(12), sprint: f(16), cobbles: f(12), stamina: f(12), recovery: f(12), stam: 100, boost: 1, wheels: 0 });
  }
  return { riders, car: (inf.data || []).find((x) => x.type === 'VEHICLES')?.level || 0 };
}

/* ===== Consignes collectives et rôles ===== */
const RE_ORDERS = { PROTECT: 'Protéger le leader', TRAIN: 'Préparer le train', ATTACK: 'Attaquer', TEMPO: 'Rouler en tête', BOTTLES: 'Aller chercher des bidons', FRONT: 'Frotter en tête' };
const reMine = (S) => Object.values(S.riders).filter((r) => r.mine && r.status === 'RACE' && r.group);
function reRoles(S) {   // rôles automatiques : leader = meilleur niveau, sprinteur = meilleur sprint parmi les autres
  const mine = Object.values(S.riders).filter((r) => r.mine && !['DNF', 'FIN'].includes(r.status)), lead = [...mine].sort((a, b) => b.level - a.level)[0];
  const spr = [...mine].filter((r) => r !== lead).sort((a, b) => b.sprint - a.sprint)[0];
  mine.forEach((r) => { r.autoRole = r === lead ? 'LEADER' : r === spr && spr.sprint > 66 ? 'SPRINTER' : 'DOM'; });
}
const reRole = (r) => r.role || r.autoRole || 'DOM';
const RE_ROLE_LABEL = { LEADER: 'Leader', DOM: 'Équipier', SPRINTER: 'Sprinteur', FREE: 'Libre' };
function reOrderEff(S, r, g) {   // multiplicateur d'effort selon la consigne active
  const o = S.order; if (!o || !r.mine || S.t > o.until) return 1;
  const role = reRole(r); if (role === 'FREE') return 1;
  if (o.id === 'PROTECT') return role === 'LEADER' ? 0.8 : 1.12;
  if (o.id === 'TRAIN') return role === 'SPRINTER' ? 0.85 : role === 'LEADER' ? 1 : 1.15;
  if (o.id === 'TEMPO') return role === 'LEADER' ? 0.9 : 1.1;
  if (o.id === 'FRONT') return 1.08;
  return 1;
}
function reGroupOfMine(S) {
  const cnt = {}; reMine(S).forEach((r) => (cnt[r.group] = (cnt[r.group] || 0) + 1));
  const id = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; return S.groups.find((g) => g.id === id) || null;
}
function reOrder(S, id) {
  const mine = reMine(S), g = reGroupOfMine(S); if (!mine.length || !g) return "Aucun de vos coureurs n'est en course dans un groupe.";
  reRoles(S);
  const inG = mine.filter((r) => r.group === g.id);
  if (id === 'ATTACK') {
    const picks = inG.filter((r) => reRole(r) !== 'LEADER' && r.atk >= 40).sort((a, b) => b.atk + b.level - (a.atk + a.level)).slice(0, 3);
    if (!picks.length) return "Personne n'a assez d'énergie d'attaque (40 % minimum, hors leader).";
    reAttackIds(S, g, picks); return `Attaque collective : ${picks.map((r) => r.name).join(', ')}.`;
  }
  if (id === 'BOTTLES') {
    const cand = inG.filter((r) => reRole(r) !== 'LEADER' && inG.some((m) => m.id !== r.id)).sort((a, b) => b.stam - a.stam)[0];
    return cand ? reSendForBottles(S, cand.id) : 'Aucun équipier disponible pour aller à la voiture.';
  }
  const spr = inG.find((r) => reRole(r) === 'SPRINTER') || inG.find((r) => reRole(r) === 'LEADER') || inG[0], dur = { PROTECT: 900, TRAIN: 900, TEMPO: 600, FRONT: 300 }[id];
  S.order = { id, until: S.t + dur, leader: spr.id };
  mine.forEach((r) => {
    const role = reRole(r); if (role === 'FREE') return;
    r.ordered = true; r.order = id === 'FRONT' ? 'FRONT' : role === 'LEADER' || (id === 'TRAIN' && role === 'SPRINTER') ? 'MID' : 'FRONT'; r.place = r.order;
    if (id === 'FRONT') r.atk = Math.max(0, r.atk - 3);
  });
  reLog(S, `Consigne : ${RE_ORDERS[id]}.`, true); return `Consigne : ${RE_ORDERS[id]}.`;
}
async function renderLiveRaceDashboard(c) {
  if (state.reTimer) { clearInterval(state.reTimer); state.reTimer = null; }
  c.innerHTML = '<p class="muted pad">Préparation de la course…</p>';
  const { data } = await sb.from('races').select('*').order('date'), races = data || [];
  if (!races.length) { c.innerHTML = '<div class="panel"><h4>Course en direct</h4><p class="muted">Aucune course au calendrier.</p></div>'; return; }
  const pick = (state.simRace && races.find((r) => r.id === state.simRace)) || (state.nextRace && races.find((r) => r.id === state.nextRace.id)) || races[0]; state.simRace = pick.id;
  const P = generateRaceProfile(pick); await loadStaffImpactCtx(state.team.id);
  const F = await buildRaceField(pick), S = createRaceState(pick, P, F.riders, F.car); state.race = S; reRoles(S);
  const VIEWS = [['all', "Vue d'ensemble"], ['lead', 'Suivre la tête'], ['team', 'Mon équipe'], ['final', 'Final']];
  c.innerHTML = `<div class="rd-grid" id="re-root">
    <div class="panel rd-instr"><h4>Instructions collectives et stratégie</h4><div class="rd-orders">${Object.entries(RE_ORDERS).map(([k, l]) => `<button data-reord="${k}">${l}</button>`).join('')}</div>
      <p class="muted" id="re-order" style="margin-top:.6rem"></p></div>
    <div class="panel rd-profile"><h4>Profil de la course en direct</h4><div class="sq-bar"><div class="sq-ctl">${selHtml('re-race', races.map((r) => [r.id, `${r.name} (${PROFILES[r.profile_type] || r.profile_type})`]), pick.id)}</div>
      <div class="muted">${P.km} km · ${P.climbs.length} col(s) · ${P.sprints.length} sprint(s) · ${P.cobbles.length} secteur(s) pavé(s)</div></div><div id="re-profile"></div></div>
    <div class="panel rd-radio"><h4>Radio Tour et journal de course</h4><div id="re-journal" class="re-journal"></div></div>
    <div class="panel rd-bottom"><h4>Marqueurs de groupes</h4><div id="re-groups"></div><h4 style="margin-top:1rem">Mon équipe</h4><div id="re-team"></div></div>
    <div class="rd-side"><div class="panel"><h4>Météo en direct</h4><div id="re-weather"></div></div>
      <div class="panel" style="margin-top:.75rem"><h4>Chrono course</h4><div id="re-clock"></div>
        <div class="re-speed re-col">${[['0', 'Pause'], ['1', 'x1'], ['2', 'x2'], ['4', 'x4'], ['8', 'x8'], ['skip', 'Saut final']].map(([v, l]) => `<button data-resp="${v}">${l}</button>`).join('')}</div></div>
      <div class="panel" style="margin-top:.75rem"><h4>Sélecteur de vues</h4><div class="re-col">${VIEWS.map(([k, l]) => `<button data-review="${k}">${l}</button>`).join('')}</div></div></div></div>`;
  const groupsView = () => S.groups.filter((g) => g.riders.length).map((g) => ({ id: g.id, type: g.type, riders: g.riders.filter((i) => S.riders[i].status === 'RACE').length, km: g.km, gap: g.gap }));
  const m = mountRaceProfile($('re-profile'), P, () => ({ currentKm: reLeadKm(S), groups: groupsView() }), (gid) => { const g = S.groups.find((x) => x.id === gid); if (g) toast(`${SIM_GROUP[g.type][0]} : ${g.riders.length} coureur(s) · ${Math.round(g.gap)} s`); });
  const bar = (v) => `<span class="mini"><i class="${v < 25 ? 'lo' : ''}" style="width:${Math.round(v)}%"></i></span> ${Math.round(v)}`;
  const status = (r) => (r.status === 'RACE' ? SIM_GROUP[(S.groups.find((g) => g.id === r.group) || {}).type]?.[0] || '-' : { PUNCT: 'Crevaison', CRASH: 'Chute', CAR: 'À la voiture', RETURN: 'Revient seul', DNF: 'Abandon', FIN: 'Arrivé' }[r.status] || r.status);
  const groupsHTML = () => `<div class="tbl"><table class="fm sq"><thead><tr><th>Groupe</th><th>Coureurs</th><th>Mon équipe</th><th>Km</th><th>Vitesse</th><th>Écart</th></tr></thead><tbody>${S.groups.filter((g) => g.riders.length).map((g) => {
    const ids = g.riders.filter((i) => S.riders[i].status === 'RACE'), mine = ids.filter((i) => S.riders[i].mine).length, [nm, col] = SIM_GROUP[g.type] || ['Groupe', '#e5e7eb'];
    return `<tr data-regroup="${g.id}" style="cursor:pointer"><td><span class="re-dot" style="background:${col}"></span>${nm}</td><td>${ids.length}</td><td>${mine || '-'}</td><td>${g.km.toFixed(1)}</td><td>${Math.round(g.v)} km/h</td><td>${g.gap > 0 ? '+' + Math.round(g.gap) + ' s' : 'en tête'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">Aucun groupe.</td></tr>'}</tbody></table></div>`;
  const teamHTML = () => `<div class="tbl"><table class="fm sq"><thead><tr><th>Photo</th><th>Nom</th><th>Rôle</th><th>Stamina</th><th>Bidons</th><th>Consigne individuelle</th></tr></thead><tbody>
    ${Object.values(S.riders).filter((r) => r.mine).map((r) => { const on = r.status === 'RACE';
      return `<tr class="${on ? '' : 'inj'}"><td><span class="re-av">${getPersonAvatar(r, 'rider')}</span></td><td>${esc(r.name)}<div class="muted" style="font-size:.7rem">${esc(status(r))}</div></td>
      <td>${on ? `<select data-rerole="${r.id}">${[['', 'Auto : ' + RE_ROLE_LABEL[reRole({ ...r, role: null })]], ['LEADER', 'Leader'], ['DOM', 'Équipier'], ['SPRINTER', 'Sprinteur'], ['FREE', 'Libre']].map(([v, l]) => `<option value="${v}" ${v === (r.role || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '-'}</td>
      <td>${bar(r.stam)}</td><td>${r.bottles} / 3</td><td>${on ? `<select data-replace="${r.id}">${[['', 'Auto (' + RE.PLACES[r.place] + ')'], ['FRONT', 'Avant'], ['MID', 'Milieu'], ['BACK', 'Arrière']].map(([v, l]) => `<option value="${v}" ${v === (r.order || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button data-reatk="${r.id}">Attaquer</button> <button data-rebot="${r.id}">Bidons</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Aucun de vos coureurs n\'est engagé.</td></tr>'}</tbody></table></div>`;
  const weatherHTML = () => { const h = S.head, kind = Math.abs(h) < 1.5 ? 'de côté' : h > 0 ? 'de face' : 'dans le dos';
    return `<div class="stat-row"><span>Température</span><b>${S.temp ?? 18} °C</b></div><div class="stat-row"><span>Vent</span><b>${Math.round(S.wind)} km/h, ${kind}</b></div><div class="stat-row"><span>Pluie</span><b class="${S.wet ? 'down' : 'up'}">${S.wet ? 'Route mouillée' : 'Sec'}</b></div>`; };
  const upd = (full = true) => {
    const lead = reLeadKm(S), lg = S.groups.find((g) => g.riders.length);
    $('re-clock').innerHTML = `<div class="stat-row"><span>Temps de course</span><b>${reClock(S.t)}</b></div><div class="stat-row"><span>Kilomètres restants</span><b>${Math.max(0, P.km - lead).toFixed(1)} km</b></div>
      <div class="stat-row"><span>Vitesse de tête</span><b>${lg ? Math.round(lg.v) : 0} km/h</b></div>${S.done ? '<div class="up" style="margin:.3rem 0"><b>Course terminée</b></div>' : ''}`;
    $('re-order').textContent = S.order && S.t <= S.order.until ? `Consigne active : ${RE_ORDERS[S.order.id]} (${Math.max(0, Math.round(S.order.until - S.t))} s)` : 'Aucune consigne collective active.';
    $('re-weather').innerHTML = weatherHTML(); $('re-groups').innerHTML = groupsHTML();
    document.querySelectorAll('[data-resp]').forEach((b) => b.classList.toggle('on', b.dataset.resp === String(S.speed)));
    m.update();
    $('re-journal').innerHTML = S.log.slice(-60).reverse().map((l) => `<div class="re-l ${l.mine ? 'mine' : ''}"><span>${reClock(l.t)} · km ${l.km.toFixed(0)}</span>${esc(l.text)}</div>`).join('');
    if (full) { reRoles(S); $('re-team').innerHTML = teamHTML(); }
  };
  const setView = (k) => {
    const v = m.view, g = reGroupOfMine(S);
    if (k === 'all') Object.assign(v, { zoom: 1, center: null, follow: false });
    else if (k === 'lead') Object.assign(v, { zoom: 3, follow: true });
    else if (k === 'team') Object.assign(v, { zoom: 3, follow: false, center: g ? g.km : reLeadKm(S) });
    else Object.assign(v, { zoom: Math.min(10, Math.max(1, P.km / 20)), follow: false, center: P.km - 10 });
    m.update();
  };
  const root = $('re-root');
  root.onclick = (e) => {
    const sp = e.target.closest('[data-resp]'), od = e.target.closest('[data-reord]'), at = e.target.closest('[data-reatk]'), bo = e.target.closest('[data-rebot]'), gr = e.target.closest('[data-regroup]'), vw = e.target.closest('[data-review]');
    if (sp) { if (sp.dataset.resp === 'skip') reSkipToFinal(S); else S.speed = +sp.dataset.resp; upd(); }
    else if (od) { toast(reOrder(S, od.dataset.reord)); upd(); }
    else if (at) { toast(reAttack(S, at.dataset.reatk)); upd(); }
    else if (bo) { toast(reSendForBottles(S, bo.dataset.rebot)); upd(); }
    else if (gr) { const g = S.groups.find((x) => x.id === gr.dataset.regroup); if (g) { Object.assign(m.view, { zoom: Math.max(m.view.zoom, 3), follow: false, center: g.km }); m.update(); } }
    else if (vw) setView(vw.dataset.review);
  };
  root.onchange = (e) => {
    const p = e.target.closest('[data-replace]'), ro = e.target.closest('[data-rerole]');
    if (p) { const r = S.riders[p.dataset.replace]; r.order = p.value || null; r.ordered = false; if (p.value) r.place = p.value; upd(); }
    else if (ro) { S.riders[ro.dataset.rerole].role = ro.value || null; reRoles(S); upd(); }
  };
  $('re-race').onchange = (e) => { state.simRace = e.target.value; renderLiveRaceDashboard(c); };
  state.reTimer = setInterval(() => {   // 200 ms réelles = 12 s de course à x1
    if (!$('re-root')) { clearInterval(state.reTimer); state.reTimer = null; return; }
    if (S.speed > 0 && !S.done) { reAdvance(S, 0.2 * RE.BASE * S.speed); upd(S.tick++ % 5 === 0 && document.activeElement?.tagName !== 'SELECT'); }
  }, 200);
  upd();
}
  const root = $('re-root');
  root.onclick = (e) => {
    const sp = e.target.closest('[data-resp]'), at = e.target.closest('[data-reatk]'), bo = e.target.closest('[data-rebot]');
    if (sp) { if (sp.dataset.resp === 'skip') reSkipToFinal(S); else S.speed = +sp.dataset.resp; upd(); }
    else if (at) { toast(reAttack(S, at.dataset.reatk)); upd(); } else if (bo) { toast(reSendForBottles(S, bo.dataset.rebot)); upd(); }
  };
  root.onchange = (e) => { const p = e.target.closest('[data-replace]'); if (p) { const r = S.riders[p.dataset.replace]; r.order = p.value || null; if (p.value) r.place = p.value; upd(); } };
  $('re-race').onchange = (e) => { state.simRace = e.target.value; renderRaceLive(c); };
  state.reTimer = setInterval(() => {   // boucle de tick : 200 ms réelles = 12 s de course à x1
    if (!$('re-root')) { clearInterval(state.reTimer); state.reTimer = null; return; }
    if (S.speed > 0 && !S.done) { reAdvance(S, 0.2 * RE.BASE * S.speed); upd(S.tick++ % 5 === 0 && document.activeElement?.tagName !== 'SELECT'); }
  }, 200);
  upd();
}
