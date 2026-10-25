// raceEngine.js — moteur physico-tactique de course (à charger APRÈS sim.js)
// Utilise sim.js (profileAlt, simRng, simGap, SIM_GROUP, generateRaceProfile, mountRaceProfile), squad.js (enrich), app.js (sb, state, esc, $, toast, PROFILES, selHtml, calculateStaffImpact, loadStaffImpactCtx)
const RE = { BASE: 60, DT: 10, PLACES: { FRONT: 'Avant', MID: 'Milieu', BACK: 'Arrière' }, SHELTER: { FRONT: 1, MID: 0.7, BACK: 0.65 } };   // BASE : secondes de course par seconde réelle à x1 ; abri dans la roue : -30 % d'effort
const reClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reClock = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}'${String(Math.floor(s % 60)).padStart(2, '0')}"`;
const reSlope = (P, km) => ((profileAlt(P, km + 0.1) - profileAlt(P, Math.max(0, km - 0.1))) / 200) * 100;                       // pente en %
const reZone = (P, km) => ({ cobble: P.cobbles.some((c) => km >= c.from && km <= c.to), wind: P.wind.find((w) => km >= w.from && km <= w.to) || null });
const reAhead = (P, km) => P.km - km < 6 || P.cobbles.some((c) => c.from > km && c.from - km < 4) || P.wind.some((w) => w.from > km && w.from - km < 4) || P.climbs.some((c) => c.start > km && c.start - km < 2);
const reLeadKm = (S) => { const k = S.groups.filter((g) => !g.finished && g.riders.length).map((g) => g.km); return k.length ? Math.max(...k) : S.profile.km; };
function reLog(S, text, mine = false) { S.log.push({ t: S.t, km: reLeadKm(S), text, mine }); if (S.log.length > 250) S.log.shift(); }

// Vitesse soutenable du coureur selon la pente (puissance en W/kg), l'aérodynamisme, les pavés, la fatigue, la fringale et sa forme
function reCap(r, slope, zone) {
  const s = Math.max(0, slope), st = s >= 5 ? r.mountain : s >= 2.5 ? (r.mountain + r.hills) / 2 : r.hills, wkg = 4.6 + (st - 50) * 0.06;
  const aero = 44 + (r.flat - 50) * 0.2 + (zone.cobble ? (r.cobbles - 60) * 0.1 - 6 : 0);
  const v = slope < 0 ? aero + Math.min(32, -slope * 3.6) : 1 / (1 / ((3.6 * wkg) / (9.81 * (s / 100 + 0.005))) + 1 / (aero * (1 + 0.35 * s)));
  return v * (0.55 + (0.45 * r.stam) / 100) * (r.boost || 1);
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
    const riders = Object.fromEntries(field.map((r) => [r.id, { ...r, status: 'RACE', place: 'MID', group: 'g0', km: 0, atk: 100, slip: 0, order: null, drop: false }]));
  const S = { race, profile, rng, t: 0, speed: 0, acc: 0, tick: 0, riders, log: [], results: [], done: false, nid: 1, car, breakDone: false, pts: { sprint: {}, kom: {} }, passed: {}, bunch: null, saved: false,
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
    const v = reClamp(motor * g.tempo * (zone.wind ? 0.985 : 1) * (1 - S.head * 0.004) * reSprintBoost(S, g, act), 8, 82); g.v = v; g.km += (v * dt) / 3600;
    if (Math.round(S.t / dt) % 6 === 0) reAutoPlace(S, g, act);

    for (const r of act) {   // effort (pente, vent, abri) → stamina, énergie d'attaque, hydratation / glycogène
      const cap = reCap(r, slope, zone), sh = 1 - (1 - RE.SHELTER[r.place]) * (slope > 6 ? 0.35 : 1), eff = (v / cap) ** 2 * sh * (g.chase ? 1.1 : 1) * reOrderEff(S, r, g);
      r.stam = reClamp(r.stam - (0.33 * eff ** 2.2 * (1.3 - r.stamina / 200) * dt) / 60 + (eff < 0.6 ? ((0.6 - eff) * 0.35 * (r.recovery / 60) * dt) / 60 : 0), 0, 100);
      if (eff > 1.05) r.atk = Math.max(0, r.atk - ((eff - 1.05) * 1.6 * dt) / 10); else if (eff < 0.9) r.atk = Math.min(100, r.atk + (0.05 * (r.recovery / 60) * dt) / 10);
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
  if (!S.groups.some((g) => !g.finished && g.riders.length) && !Object.values(S.riders).some((r) => ['RETURN', 'PUNCT', 'CRASH'].includes(r.status))) {
    S.done = true; reLog(S, 'Classement : ' + S.results.slice(0, 5).map((r) => `${r.pos}. ${r.name}`).join(' · '));
  }
}

function reIncident(S, g, r, kind, dur) {
  const hit = [r];
  if (kind === 'CRASH') g.riders.filter((i) => i !== r.id).forEach((i) => { const o = S.riders[i]; if (o.status === 'RACE' && hit.length < 4 && S.rng() < 0.04) hit.push(o); });
  hit.forEach((x) => {
    g.riders = g.riders.filter((i) => i !== x.id); x.group = null; (x.inc = x.inc || []).push(kind === 'PUNCT' ? 'PUNCTURE' : 'CRASH'); x.km = g.km;; x.until = S.t + Math.max(25, dur); x.status = kind;
    if (kind === 'CRASH') { x.stam = Math.max(0, x.stam - 12); if (S.rng() < 0.25) { x.status = 'DNF'; reLog(S, `Abandon sur chute de ${x.name} (${x.team}).`, x.mine); } }
  });
  reLog(S, kind === 'PUNCT' ? `Crevaison pour ${r.name} (${r.team}).` : `Chute : ${hit.map((x) => x.name).join(', ')}.`, hit.some((x) => x.mine));
}
function reSolos(S, dt) {   // coureurs hors groupe : crevaison / chute en cours, aller à la voiture, retour seul
  const P = S.profile;
  for (const r of Object.values(S.riders)) {
    if (r.status === 'PUNCT' || r.status === 'CRASH') { if (S.t >= r.until) r.status = 'RETURN'; continue; }
    if (r.status !== 'RETURN') continue;
    const v = reCap(r, reSlope(P, r.km), reZone(P, r.km)) * 1.08; r.km += (v * dt) / 3600; r.alone = (r.alone || 0) + dt;
      if (r.km >= S.profile.km) { reNewGroup(S, 'DROPPED', S.profile.km, [r], 0.88); continue; }
    r.stam = Math.max(0, r.stam - (0.33 * 1.2 ** 2.2 * (1.3 - r.stamina / 200) * dt) / 60);
    const g2 = S.groups.find((g) => !g.finished && g.riders.length && Math.abs(g.km - r.km) < 0.15);
    if (g2) { g2.riders.push(r.id); r.group = g2.id; r.status = 'RACE'; r.alone = 0; r.slip = 0; if (r.mine) reLog(S, `${r.name} est revenu dans le groupe.`, true); }
    else if (r.stam < 8 || r.alone > 900) { r.alone = 0; reNewGroup(S, 'DROPPED', r.km, [r], 0.88); }
  }
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
/* ===== Fin de course : emballage final, classements, primes, sauvegarde ===== */
const RE_UCI = [100, 70, 50, 40, 30, 25, 20, 15, 10, 8, 6, 5, 4, 3, 2];
const RE_PRIZE = [8000, 4000, 2000, 1500, 1000, 700, 500, 400, 300, 200];
const RE_KOM = { HC: [20, 15, 12, 10, 8, 6, 4, 2], 1: [10, 8, 6, 4, 2, 1], 2: [5, 3, 2, 1], 3: [2, 1], 4: [1] };
const RE_CAT = { '1.1': 1, '1.Pro': 1.4, '1.UWT': 2, '2.1': 0.7, '2.Pro': 1.5, '2.UWT': 2.5 };   // barème selon la catégorie de la course

// 5 derniers km : le groupe accélère par paliers (5 km, 2 km, 300 m) selon la qualité de son meilleur sprinteur (sprint + accélération)
function reSprintBoost(S, g, act) {
  const left = S.profile.km - g.km; if (left > 5 || left < 0 || act.length < 2 || g.type === 'DROPPED') return 1;
  const q = Math.max(...act.map((r) => (r.sprint + r.acc) / 2)), phase = left > 2 ? 0.05 : left > 0.3 ? 0.11 : 0.17;
  return 1 + phase * (0.7 + (q - 50) / 100);
}
// Emballage : dans chaque équipe, le meilleur rouleur devient poisson-pilote et lance le meilleur sprinteur (ordre « Préparer le train » pour votre équipe)
function reBunchLog(S, g, act) {
  if (S.bunch || S.profile.km - g.km > 5 || act.length < 6) return;
  S.bunch = { gid: g.id }; const by = {}; let trains = 0;
  act.forEach((r) => (by[r.teamId] = by[r.teamId] || []).push(r));
  Object.values(by).forEach((rs) => {
    if (rs.length < 2) return;
    const sp = (rs[0].mine && S.order?.id === 'TRAIN' && rs.find((r) => r.id === S.order.leader)) || [...rs].sort((a, b) => b.sprint - a.sprint)[0];
    const pilot = rs.filter((r) => r !== sp && r.stam > 30).sort((a, b) => b.flat + b.stamina - (a.flat + a.stamina))[0];
    if (!pilot) return;
    sp.led = reClamp((pilot.flat + pilot.stamina) / 160 - 0.35, 0.1, 0.8);                     // qualité du poisson-pilote
    pilot.stam = Math.max(0, pilot.stam - 8); pilot.atk = Math.max(0, pilot.atk - 25); pilot.pilot = true; trains++;
    if (sp.mine || pilot.mine) reLog(S, `Train de ${pilot.team} : ${pilot.name} lance ${sp.name}.`, true);
  });
  reLog(S, `Emballage final : ${act.length} coureurs à moins de 5 km de l'arrivée, ${trains} train(s) organisé(s).`);
}
// Sprints intermédiaires et cols : points au premier groupe qui passe (maillots des sprints et de la montagne)
function reCheckpoints(S, g, prev) {
  const P = S.profile, act = g.riders.map((i) => S.riders[i]).filter((r) => r.status === 'RACE'); if (!act.length) return;
  const best = (key, n) => act.map((r) => [r, r[key] * (0.5 + r.atk / 200) + (S.rng() - 0.5) * 8]).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
  const give = (map, list, pts) => list.forEach((r, i) => (map[r.id] = (map[r.id] || 0) + pts[i]));
  P.sprints.forEach((s, i) => {
    if (S.passed['S' + i] || !(prev < s.km && g.km >= s.km)) return; S.passed['S' + i] = 1;
    const top = best('sprint', 3); give(S.pts.sprint, top, [12, 8, 5]); top.forEach((r) => (r.atk = Math.max(0, r.atk - 6)));
    reLog(S, `Sprint intermédiaire n°${i + 1} : ${top[0].name} (${top[0].team}) passe en tête.`, top.some((r) => r.mine));
  });
  P.climbs.forEach((c, i) => {
    if (S.passed['C' + i] || !(prev < c.km && g.km >= c.km)) return; S.passed['C' + i] = 1;
    const pts = RE_KOM[c.cat] || [1], top = best('mountain', pts.length); give(S.pts.kom, top, pts);
    reLog(S, `Col de ${c.cat === 'HC' ? 'hors catégorie' : 'catégorie ' + c.cat} (km ${c.km.toFixed(0)}) : ${top[0].name} (${top[0].team}) passe en tête.`, top.some((r) => r.mine));
  });
}
// Score de sprint : sprint, accélération, énergie, stamina, placement (Avant / Milieu / Arrière) et poisson-pilote
function reSprintScore(S, r) {
  const place = { FRONT: 1.05, MID: 1, BACK: 0.92 }[r.place] || 1, pil = r.led ? 1 + 0.08 * r.led : 1, ord = S.order?.id === 'TRAIN' && r.id === S.order.leader ? 1.07 : 1;
  const base = (r.sprint * 0.65 + r.acc * 0.35) * (0.55 + (0.45 * r.atk) / 100) * (0.6 + (0.4 * r.stam) / 100) * place * pil * ord;
  return { score: base * (0.92 + 0.16 * S.rng()), parts: { sprint: r.sprint, acc: r.acc, place: r.place, pilot: r.led ? +(r.led * 8).toFixed(1) : 0 } };
}
function reFinish(S, g) {
  const total = S.profile.km, act = g.riders.map((id) => S.riders[id]).filter((r) => r.status === 'RACE');
  const t0 = S.t - ((g.km - total) / Math.max(g.v, 1)) * 3600, sc = act.map((r) => ({ r, ...reSprintScore(S, r) })).sort((a, b) => b.score - a.score);
  if (sc.length >= 3 && (!S.sprint || sc.length > S.sprint.n)) S.sprint = { n: sc.length, order: sc.slice(0, 10).map((x) => ({ id: x.r.id, name: x.r.name, team: x.r.team, mine: x.r.mine, score: x.score, parts: x.parts })) };
  sc.forEach(({ r }, i) => { r.status = 'FIN'; S.results.push({ id: r.id, name: r.name, team: r.team, teamId: r.teamId, mine: r.mine, time: Math.round(t0 + i * 0.1), inc: r.inc || [], stam: r.stam }); });
  g.finished = true; g.riders = [];
  if (sc[0]) reLog(S, `Arrivée : ${sc[0].r.name} (${sc[0].r.team}) s'impose${sc.length > 1 ? ' au sprint' : ' en solitaire'}.`, sc.some((x) => x.r.mine));
}

// Classements final, maillots, points UCI et primes
function reBuildResults(S) {
  const scale = RE_CAT[S.race.category] || 1, fin = [...S.results].sort((a, b) => a.time - b.time).map((r, i) => ({ ...r, pos: i + 1 }));
  const gone = Object.values(S.riders).filter((r) => !fin.some((x) => x.id === r.id)).map((r, i) => ({ id: r.id, name: r.name, team: r.team, teamId: r.teamId, mine: r.mine, dnf: true, inc: [...(r.inc || []), 'DNF'], stam: r.stam, pos: fin.length + i + 1 }));
  fin.forEach((r) => { r.gap = r.time - fin[0].time; r.uci = Math.round((RE_UCI[r.pos - 1] || 0) * scale); r.prize = Math.round((RE_PRIZE[r.pos - 1] || 0) * scale); });
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([id, pts]) => ({ id, pts, name: S.riders[id].name, team: S.riders[id].team, mine: S.riders[id].mine }));
  const sprint = top(S.pts.sprint), kom = top(S.pts.kom);
  [sprint[0], kom[0]].forEach((j) => { const r = j && fin.find((x) => x.id === j.id); if (r) r.prize += 500; });   // prime de maillot
  const teams = {}; [...fin, ...gone].forEach((r) => { const t = (teams[r.team] = teams[r.team] || { team: r.team, uci: 0, prize: 0, mine: r.mine }); t.uci += r.uci || 0; t.prize += r.prize || 0; });
  return { fin, gone, all: [...fin, ...gone], sprint, kom, teams: Object.values(teams).sort((a, b) => b.uci - a.uci || b.prize - a.prize) };
}
function reSummary(S, R) {
  const w = R.fin[0], L = S.log, n = (k) => L.filter((l) => l.text.startsWith(k)).length, atk = L.find((l) => l.text.startsWith('Attaque')), mine = R.fin.find((r) => r.mine);
  return [`${S.race.name} : ${w.name} (${w.team}) s'impose${S.sprint ? ' au sprint' : ''}.`, `Podium : ${R.fin.slice(0, 3).map((r) => `${r.pos}. ${r.name} (${r.team})`).join(' · ')}.`,
    atk ? `Fait de course : ${atk.text}` : 'Course contrôlée par le peloton.', `${n('Crevaison')} crevaison(s), ${n('Chute')} chute(s), ${R.gone.length} abandon(s).`,
    R.sprint[0] ? `Maillot des sprints : ${R.sprint[0].name} (${R.sprint[0].pts} pts).` : '', R.kom[0] ? `Meilleur grimpeur : ${R.kom[0].name} (${R.kom[0].pts} pts).` : '',
    mine ? `Votre équipe : meilleur résultat ${mine.pos}e avec ${mine.name}.` : "Votre équipe n'a pas terminé dans le classement."].filter(Boolean).join('\n');
}
// Sauvegarde : race_results, race_summaries, points UCI et budget des équipes, fatigue des coureurs (coureurs réels uniquement)
async function saveRaceResults(S, R, P) {
  const real = R.all.filter((r) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(r.id));
  const results = real.map((r) => ({ rider_id: r.id, position: r.pos, gap: r.gap || 0, uci: r.uci || 0, prize: r.prize || 0, incident: (r.inc || [])[0] || null }));
  const fatigue = Object.fromEntries(real.map((r) => [r.id, r.dnf ? 35 : Math.round(12 + (100 - (r.stam ?? 60)) * 0.3 + P.km / 25)]));
  const { error } = await sb.rpc('save_race_results', { p_race: S.race.id, p_results: results, p_summary: reSummary(S, R), p_fatigue: fatigue });
  if (error) return error.message;
  const { data: t } = await sb.from('teams').select('*').eq('id', state.team.id).single(); if (t) state.team = t;
  await loadGame(); S.saved = true; return null;
}

async function renderRaceResults(c, S, P) {
  const R = reBuildResults(S), mine = R.all.filter((r) => r.mine);
  if (!R.fin.length) { c.innerHTML = '<div class="panel"><h4>Résultats</h4><p class="muted">Aucun coureur n\'a terminé la course.</p></div>'; return; }
  let tab = state.resTab || 'gc';
  const gapT = (g) => (g > 0 ? `+${Math.floor(g / 60)}'${String(g % 60).padStart(2, '0')}"` : ''), tbl = (h, rows) => `<div class="tbl"><table class="fm sq"><thead><tr>${h.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('') || '<tr><td colspan="6" class="muted">Aucune donnée.</td></tr>'}</tbody></table></div>`;
  const rowGc = (r) => `<tr class="${r.mine ? 'me' : ''}"><td>${r.pos}</td><td>${esc(r.name)}</td><td>${esc(r.team)}</td><td>${r.dnf ? 'Abandon' : r.pos === 1 ? reClock(R.fin[0].time) : gapT(r.gap)}</td><td>${r.uci ? r.uci + ' pts' : '-'}</td><td>${r.prize ? fmtEUR(r.prize) : '-'}</td></tr>`;
  const rowJ = (x, i) => `<tr class="${x.mine ? 'me' : ''}"><td>${i + 1}</td><td>${esc(x.name)}</td><td>${esc(x.team)}</td><td>${x.pts} pts</td></tr>`;
  const bodies = {
    gc: () => tbl(['Pos.', 'Coureur', 'Équipe', 'Temps / écart', 'Points UCI', 'Prime'], R.all.map(rowGc)), mine: () => tbl(['Pos.', 'Coureur', 'Équipe', 'Temps / écart', 'Points UCI', 'Prime'], mine.map(rowGc)),
    sprint: () => tbl(['#', 'Coureur', 'Équipe', 'Points'], R.sprint.map(rowJ)), kom: () => tbl(['#', 'Coureur', 'Équipe', 'Points'], R.kom.map(rowJ)),
    teams: () => tbl(['#', 'Équipe', 'Points UCI', 'Primes'], R.teams.map((t, i) => `<tr class="${t.mine ? 'me' : ''}"><td>${i + 1}</td><td>${esc(t.team)}</td><td>${t.uci} pts</td><td>${fmtEUR(t.prize)}</td></tr>`)),
  };
  const spr = () => { const o = (S.sprint?.order || []).slice(0, 8); if (!o.length) return '<p class="muted">Arrivée en solitaire : pas de sprint.</p>'; const best = o[0].score;
    return `<div class="sp-track">${o.map((x, i) => `<div class="sp-r ${x.mine ? 'mine' : ''}" data-dur="${(2.4 + ((best - x.score) / best) * 12).toFixed(2)}" style="top:${i * 28 + 8}px"><span class="sp-n">${i + 1}</span>${esc(x.name)}</div>`).join('')}<div class="sp-line"></div></div>
      <div class="muted" style="font-size:.78rem">${o.slice(0, 3).map((x) => `${esc(x.name)} : sprint ${x.parts.sprint}, accélération ${x.parts.acc}, placement ${RE.PLACES[x.parts.place] || x.parts.place}${x.parts.pilot ? ', poisson-pilote +' + x.parts.pilot + ' %' : ''}`).join(' · ')}</div>`; };
  const play = () => requestAnimationFrame(() => { const els = c.querySelectorAll('.sp-r'); els.forEach((e) => { e.style.transition = 'none'; e.style.left = '0'; }); requestAnimationFrame(() => els.forEach((e) => { e.style.transition = `left ${e.dataset.dur}s cubic-bezier(.25,.8,.3,1)`; e.style.left = 'calc(100% - 170px)'; })); });
  const draw = () => {
    c.innerHTML = `<div class="panel"><h4>Résultats : ${esc(S.race.name)}</h4><div class="muted">${P.km} km · temps du vainqueur ${reClock(R.fin[0].time)} · ${R.fin.length} arrivé(s), ${R.gone.length} abandon(s)</div>
      <div class="res-top" style="margin-top:.7rem">${R.fin.slice(0, 3).map((r) => `<div class="res-pod"><div class="pos">${r.pos}</div><b>${esc(r.name)}</b><div class="muted">${esc(r.team)}</div><div>${r.uci} pts UCI · ${fmtEUR(r.prize)}</div></div>`).join('')}</div>
      <div class="stat-row"><span>Votre équipe : points UCI gagnés</span><b>${mine.reduce((s, r) => s + (r.uci || 0), 0)} pts</b></div><div class="stat-row"><span>Votre équipe : primes</span><b>${fmtEUR(mine.reduce((s, r) => s + (r.prize || 0), 0))}</b></div>
      <div class="muted" id="res-save" style="margin-top:.4rem">${S.saved ? 'Résultats enregistrés : classement UCI et fatigue mis à jour.' : 'Enregistrement des résultats…'}</div>
      <div class="rov-btns"><button data-resnew>Course suivante</button></div></div>
    <div class="panel" style="margin-top:.75rem"><h4>Sprint final</h4>${spr()}<div class="rov-btns"><button data-resprint>Rejouer le sprint</button></div></div>
    <div class="panel" style="margin-top:.75rem"><div class="tabs">${[['gc', 'Classement général'], ['sprint', 'Maillot des sprints'], ['kom', 'Maillot de la montagne'], ['mine', 'Mon équipe'], ['teams', 'Équipes']].map(([k, l]) => `<button data-restab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>${bodies[tab]()}</div>`;
    play();
  };
  c.onclick = (e) => {
    const t = e.target.closest('[data-restab]');
    if (t) { tab = state.resTab = t.dataset.restab; draw(); } else if (e.target.closest('[data-resprint]')) play(); else if (e.target.closest('[data-resnew]')) go('portal', 'competitions');
  };
  draw();
  if (!S.saved && !S.saving) {
    S.saving = true;
    const err = await saveRaceResults(S, R, P), el = $('res-save');
    if (el) el.textContent = err ? `Résultats non enregistrés : ${err}` : 'Résultats enregistrés : classement UCI, primes, fatigue et résumé de course mis à jour.';
    toast(err ? err : 'Résultats enregistrés.');
  }
}

const reMake = (r, t, mine) => ({ id: r.id, photo_url: r.photo_url, photo_crop: r.photo_crop, name: `${r.first_name} ${r.last_name}`, team: t.official_name || t.name, teamId: t.id, mine, level: r.level, flat: r.flat || 60, mountain: r.mountain || 60,
  hills: r.hills || 60, time_trial: r.time_trial || 60, sprint: r.sprint || 60, acc: r.acc || r.sprint || 60, cobbles: r.cobbles || 60, stamina: r.stamina || 60, recovery: r.recovery || 60, wheels: 0,
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
    riders.push({ id: 'f' + i, name: `Coureur ${i + 1}`, team: `Équipe ${teams[i % teams.length]}`, teamId: 'f', mine: false, level: q, flat: f(12), mountain: f(14), hills: f(12), time_trial: f(12), sprint: f(16), acc: f(16), cobbles: f(12), stamina: f(12), recovery: f(12), stam: 100, boost: 1, wheels: 0 });
  }
  return { riders, car: (inf.data || []).find((x) => x.type === 'VEHICLES')?.level || 0 };
}

/* ===== Consignes collectives et rôles ===== */
const RE_ORDERS = { PROTECT: 'Protéger le leader', TRAIN: 'Préparer le train', ATTACK: 'Attaquer', TEMPO: 'Rouler en tête', FRONT: 'Frotter en tête' };
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
  const status = (r) => (r.status === 'RACE' ? SIM_GROUP[(S.groups.find((g) => g.id === r.group) || {}).type]?.[0] || '-' : { PUNCT: 'Crevaison', CRASH: 'Chute', RETURN: 'Revient seul', DNF: 'Abandon', FIN: 'Arrivé' }[r.status] || r.status);
  const groupsHTML = () => `<div class="tbl"><table class="fm sq"><thead><tr><th>Groupe</th><th>Coureurs</th><th>Mon équipe</th><th>Km</th><th>Vitesse</th><th>Écart</th></tr></thead><tbody>${S.groups.filter((g) => g.riders.length).map((g) => {
    const ids = g.riders.filter((i) => S.riders[i].status === 'RACE'), mine = ids.filter((i) => S.riders[i].mine).length, [nm, col] = SIM_GROUP[g.type] || ['Groupe', '#e5e7eb'];
    return `<tr data-regroup="${g.id}" style="cursor:pointer"><td><span class="re-dot" style="background:${col}"></span>${nm}</td><td>${ids.length}</td><td>${mine || '-'}</td><td>${g.km.toFixed(1)}</td><td>${Math.round(g.v)} km/h</td><td>${g.gap > 0 ? '+' + Math.round(g.gap) + ' s' : 'en tête'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">Aucun groupe.</td></tr>'}</tbody></table></div>`;
  const teamHTML = () => `<div class="tbl"><table class="fm sq"><thead><tr><th>Photo</th><th>Nom</th><th>Rôle</th><th>Stamina</th><th>Consigne individuelle</th></tr></thead><tbody>
    ${Object.values(S.riders).filter((r) => r.mine).map((r) => { const on = r.status === 'RACE';
      return `<tr class="${on ? '' : 'inj'}"><td><span class="re-av">${getPersonAvatar(r, 'rider')}</span></td><td>${esc(r.name)}<div class="muted" style="font-size:.7rem">${esc(status(r))}</div></td>
      <td>${on ? `<select data-rerole="${r.id}">${[['', 'Auto : ' + RE_ROLE_LABEL[reRole({ ...r, role: null })]], ['LEADER', 'Leader'], ['DOM', 'Équipier'], ['SPRINTER', 'Sprinteur'], ['FREE', 'Libre']].map(([v, l]) => `<option value="${v}" ${v === (r.role || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '-'}</td>
      <td>${bar(r.stam)}</td><td>${on ? `<select data-replace="${r.id}">${[['', 'Auto (' + RE.PLACES[r.place] + ')'], ['FRONT', 'Avant'], ['MID', 'Milieu'], ['BACK', 'Arrière']].map(([v, l]) => `<option value="${v}" ${v === (r.order || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button data-reatk="${r.id}">Attaquer</button> ` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Aucun de vos coureurs n\'est engagé.</td></tr>'}</tbody></table></div>`;
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
    const sp = e.target.closest('[data-resp]'), od = e.target.closest('[data-reord]'), at = e.target.closest('[data-reatk]'), gr = e.target.closest('[data-regroup]'), vw = e.target.closest('[data-review]'); od = e.target.closest('[data-reord]'), at = e.target.closest('[data-reatk]'), bo = e.target.closest('[data-rebot]'), gr = e.target.closest('[data-regroup]'), vw = e.target.closest('[data-review]');
    if (sp) { if (sp.dataset.resp === 'skip') reSkipToFinal(S); else S.speed = +sp.dataset.resp; upd(); }
    else if (od) { toast(reOrder(S, od.dataset.reord)); upd(); }
    else if (at) { toast(reAttack(S, at.dataset.reatk)); upd(); }
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
