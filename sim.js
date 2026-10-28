// sim.js — Simulation 2D de course en direct : profil altimétrique (génération + rendu SVG)
// Utilise esc, $, sb, state, PROFILES (app.js) et selHtml (recruit.js)
const SIM_LV = ['4', '3', '2', '1', 'HC'];
const simCat = (gain, len) => {   // difficulté = longueur × pente² (calibrée sur les catégories ProCyclingStats)
  if (!len) return gain >= 900 ? 'HC' : gain >= 600 ? '1' : gain >= 350 ? '2' : gain >= 160 ? '3' : '4';
  if (gain < 80) return '4';
  const g = gain / (len * 10), d = len * g * g;
  return d >= 900 ? 'HC' : d >= 450 ? '1' : d >= 140 ? '2' : d >= 60 ? '3' : '4';
};
function simRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function profileAlt(P, km) {
  const a = P.points; if (km <= 0) return a[0][1]; if (km >= P.km) return a[a.length - 1][1];
  let lo = 0, hi = a.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m][0] <= km) lo = m; else hi = m; }
  return a[lo][1] + ((km - a[lo][0]) / (a[hi][0] - a[lo][0])) * (a[hi][1] - a[lo][1]);
}

// race : { id, name, profile_type: FLAT | HILLS | MOUNTAIN | COBBLES | TIME_TRIAL, distance_km, elevation_m } : même course = même profil (graine fixe)
function generateRaceProfile(race) {
  if (race.profile_data?.points) return simProfileFromData(race);
  const type = race.profile_type || 'FLAT', dist = Math.max(10, Number(race.distance_km) || 150), rng = simRng(String(race.id || race.name || 'course') + type);
  const R = (a, b) => a + rng() * (b - a), I = (a, b) => Math.floor(R(a, b + 1)), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ov = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const CFG = { FLAT: { base: [15, 60], n: [0, 1], elev: 250, max: 200, gr: [3, 6], amp: 8 }, COBBLES: { base: [20, 90], n: [0, 2], elev: 400, max: 200, gr: [3, 6], amp: 12 },
    HILLS: { base: [120, 320], n: [4, 7], elev: 2600, max: 450, gr: [4, 8], amp: 25 }, MOUNTAIN: { base: [350, 900], n: [3, 5], elev: 4200, max: 1400, gr: [5, 9], amp: 30 },
    TIME_TRIAL: { base: [10, 80], n: [0, 1], elev: 150, max: 120, gr: [3, 5], amp: 6 } };
  const cfg = CFG[type] || CFG.FLAT, elev = Number(race.elevation_m) || cfg.elev, n = Math.min(I(cfg.n[0], cfg.n[1]), Math.ceil(dist / 25));

  // Cols : un par tranche de parcours, durée = dénivelé / pente moyenne, catégorie selon la longueur et la pente
  const w = Array.from({ length: n }, () => R(0.6, 1.4)), ws = w.reduce((a, b) => a + b, 0) || 1;
  const lo = Math.min(10, dist * 0.08), hi = dist - Math.min(5, dist * 0.04), slot = (hi - lo) / Math.max(1, n), climbs = [];
  for (let i = 0; i < n; i++) {
    const gr = R(cfg.gr[0], cfg.gr[1]); let gain = Math.min(cfg.max, Math.max(50, (elev * 0.65 * w[i]) / ws)), len = gain / (10 * gr);
    if (len > slot / 1.7) { len = slot / 1.7; gain = len * 10 * gr; }
    const top = type === 'MOUNTAIN' && i === n - 1 && rng() < 0.5;                         // arrivée au sommet
    const start = top ? dist - len : lo + i * slot + R(0, Math.max(0, slot - len * 1.7));
    climbs.push({ start, km: start + len, len, gain: Math.round(gain), grad: +(gain / (len * 10)).toFixed(1), dlen: top ? 0 : len * 0.6, cat: simCat(gain, len), top });
  }
  const base = R(cfg.base[0], cfg.base[1]), p1 = R(0, 6.28), p2 = R(0, 6.28), smooth = (x) => { x = clamp(x, 0, 1); return 0.7 * x + 0.3 * x * x * (3 - 2 * x); };
  const alt = (km) => {
    let a = base + cfg.amp * (Math.sin(km * 0.35 + p1) + 0.6 * Math.sin(km * 0.11 + p2));
    for (const c of climbs) { if (km >= c.start && km <= c.km) a += c.gain * smooth((km - c.start) / c.len); else if (km > c.km && c.dlen) a += c.gain * (1 - smooth((km - c.km) / c.dlen)); }
    return Math.max(0, a);
  };
  const step = Math.max(0.25, dist / 480), points = [];
  for (let k = 0; k < dist; k += step) points.push([+k.toFixed(2), Math.round(alt(k))]);
  points.push([dist, Math.round(alt(dist))]);

  // Sprints intermédiaires (S) : hors des cols
  const free = (k, wd) => !climbs.some((c) => ov(k - wd, k + wd, c.start - 1, c.km + c.dlen + 1));
  const place = (k0, wd) => { let k = clamp(k0, 15, dist - 8), t = 0; while (!free(k, wd) && t++ < 60) k += 1.5; return Math.min(k, dist - 6); };
  const ns = type === 'TIME_TRIAL' ? 0 : dist > 170 ? 2 : dist > 70 ? 1 : 0;
  const sprints = Array.from({ length: ns }, (_, i) => ({ km: +place(dist * (ns === 1 ? R(0.45, 0.6) : i === 0 ? R(0.28, 0.4) : R(0.6, 0.72)), 1).toFixed(1) }));

  // Secteurs pavés (course de type COBBLES) : de plus en plus durs vers l'arrivée
  const cobbles = [];
  if (type === 'COBBLES') {
    const nc = Math.max(3, Math.min(I(9, 14), Math.floor(dist / 12))), c0 = dist * 0.28, seg = (dist - 10 - c0) / nc;
    for (let i = 0; i < nc; i++) { const len = R(0.8, 3.2), from = c0 + i * seg + R(0, Math.max(0, seg - len - 0.3)); cobbles.push({ from: +from.toFixed(1), to: +(from + len).toFixed(1), stars: clamp(Math.round(1 + (i / nc) * 3 + R(-0.8, 1.2)), 1, 5), n: nc - i }); }
    cobbles.slice(-2).forEach((s) => (s.stars = Math.max(s.stars, 4)));
  }
  // Zones de vent / bordures : terrain plat et ouvert
  const wind = [], nw = type === 'FLAT' || type === 'COBBLES' ? (dist < 100 ? 1 : I(1, 3)) : type === 'HILLS' && rng() < 0.4 ? 1 : 0;
  for (let a = 0; a < 40 && wind.length < nw; a++) {
    const len = R(4, 12), from = R(dist * 0.2, Math.max(dist * 0.2 + 1, dist * 0.8 - len)), to = from + len;
    if (to > dist - 4 || climbs.some((c) => ov(from, to, c.start, c.km + c.dlen)) || cobbles.some((c) => ov(from, to, c.from - 1, c.to + 1)) || wind.some((x) => ov(from, to, x.from - 2, x.to + 2))) continue;
    wind.push({ from: +from.toFixed(1), to: +to.toFixed(1), dir: rng() < 0.5 ? 'L' : 'R' });
  }
  wind.sort((a, b) => a.from - b.from);
  const alts = points.map((p) => p[1]);
  return { raceId: race.id, name: race.name || 'Course', type, km: dist, points, climbs, sprints, cobbles, wind, minAlt: Math.min(...alts), maxAlt: Math.max(...alts) };
}
const SIM_GROUP = { BREAK: ['Échappée', '#f472b6'], PELOTON: ['Peloton', '#a78bfa'], CHASE: ['Poursuivants', '#fbbf24'], DROPPED: ['Lâchés', '#9ca3af'] };
const simSlope = (s) => (s < -1.5 ? '#94a3b8' : s < 2 ? '#fde68a' : s < 4.5 ? '#facc15' : s < 7.5 ? '#fb923c' : '#dc2626');
const simGap = (s) => (s > 0 ? `+${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, '0')}"` : 'en tête');

// groups : [{ id, type: BREAK | PELOTON | CHASE | DROPPED, name?, km, riders, gap (secondes) }] · view : { zoom, center, follow }
function renderRaceProfileSVG(P, currentKm = 0, groups = [], view = { zoom: 1, center: null, follow: false }) {
  const W = 1000, H = 250, ml = 14, mr = 14, mt = 40, mb = 44, pw = W - ml - mr, ph = H - mt - mb, dist = P.km, base = mt + ph;
  const z = Math.max(1, view.zoom || 1), span = dist / z, lead = Math.max(currentKm || 0, ...groups.map((g) => g.km || 0));
  const ctr = view.follow || view.center == null ? (z > 1 ? lead : dist / 2) : view.center;
  const v0 = Math.max(0, Math.min(dist - span, ctr - span / 2)), v1 = v0 + span;
  const N = Math.min(600, pw), ks = Array.from({ length: N + 1 }, (_, i) => v0 + (i / N) * span), al = ks.map((k) => profileAlt(P, k));
  const lo = Math.min(...al), hi = Math.max(...al), pad = Math.max(30, (hi - lo) * 0.25), amin = lo - pad * 0.5, amax = hi + pad * 1.4;
  const X = (k) => +(ml + ((k - v0) / span) * pw).toFixed(1), Y = (a) => +(mt + ph - ((a - amin) / (amax - amin)) * ph).toFixed(1);

  const area = `M${X(v0)} ${base} ` + ks.map((k, i) => `L${X(k)} ${Y(al[i])}`).join(' ') + ` L${X(v1)} ${base} Z`;
  const runs = []; let cur = null;                                                                 // ligne d'altitude colorée selon la pente
  for (let i = 1; i < ks.length; i++) {
    const s = ((al[i] - al[i - 1]) / ((ks[i] - ks[i - 1]) * 1000)) * 100, col = simSlope(s);
    if (!cur || cur.col !== col) { cur = { col, d: `M${X(ks[i - 1])} ${Y(al[i - 1])}` }; runs.push(cur); }
    cur.d += ` L${X(ks[i])} ${Y(al[i])}`;
  }
  const band = (a, b, fill, op) => {
    const k1 = Math.max(a, v0), k2 = Math.min(b, v1); if (k2 <= k1) return '';
    const pts = Array.from({ length: 21 }, (_, i) => k1 + ((k2 - k1) * i) / 20);
    return `<path d="M${X(k1)} ${base} ${pts.map((k) => `L${X(k)} ${Y(profileAlt(P, k))}`).join(' ')} L${X(k2)} ${base} Z" fill="${fill}" opacity="${op}"/>`;
  };
  const bar = (a, b, fill) => { const k1 = Math.max(a, v0), k2 = Math.min(b, v1); return k2 > k1 ? `<rect x="${X(k1)}" y="${base + 3}" width="${Math.max(2, X(k2) - X(k1))}" height="5" rx="1" fill="${fill}"/>` : ''; };
  const pin = (km, txt, fill, r, title) => {
    if (km < v0 - 0.5 || km > v1 + 0.5) return '';
    const x = X(km), ya = Y(profileAlt(P, km)), y0 = Math.max(18, ya - 26);
    return `<g><title>${esc(title)}</title><line x1="${x}" y1="${y0 + r}" x2="${x}" y2="${ya}" stroke="#e5e7eb" stroke-width="1.2"/><circle cx="${x}" cy="${y0}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1.5"/><text x="${x}" y="${y0 + 3.5}" text-anchor="middle" font-size="${txt.length > 1 ? 8 : 10}" font-weight="700" fill="#fff">${txt}</text></g>`;
  };
  const tick = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => span / s <= 10) || 100, ticks = [];
  for (let k = Math.ceil(v0 / tick) * tick; k <= v1 + 0.01; k += tick) ticks.push(k);

  const cobbles = P.cobbles.map((c) => band(c.from, c.to, '#b45309', 0.6)).join('');
  const wind = P.wind.map((w) => band(w.from, w.to, '#38bdf8', 0.3) + (w.to >= v0 && w.from <= v1 ? `<g><title>Vent de côté (${w.dir === 'L' ? 'gauche' : 'droite'}) : risque de bordures</title><use href="#simWind" x="${X((Math.max(w.from, v0) + Math.min(w.to, v1)) / 2) - 9}" y="${mt + 2}" width="18" height="18"/></g>` : '')).join('');
  const bars = P.climbs.map((c) => bar(c.start, c.km, '#f43f5e')).join('') + P.cobbles.map((c) => bar(c.from, c.to, '#b45309')).join('');
  const labels = P.cobbles.filter((c) => c.to >= v0 && c.from <= v1 && X(Math.min(c.to, v1)) - X(Math.max(c.from, v0)) > 14).map((c) => `<text x="${X((Math.max(c.from, v0) + Math.min(c.to, v1)) / 2)}" y="${base + 19}" text-anchor="middle" font-size="8" fill="#f59e0b">${'★'.repeat(c.stars)}</text>`).join('');
  const pins = P.climbs.map((c) => pin(c.km, c.cat, c.cat === 'HC' ? '#7f1d1d' : '#db2777', c.cat === 'HC' ? 11 : 9, `${c.name ? c.name + ' · ' : ''}Col de catégorie ${c.cat} : ${c.len.toFixed(1)} km à ${c.grad} % (+${c.gain} m) · km ${c.km.toFixed(0)}`)).join('')
    + P.sprints.map((s, i) => pin(s.km, 'S', '#10b981', 9, `Sprint intermédiaire n°${i + 1} · km ${s.km}`)).join('');
  const marks = groups.filter((g) => g.km >= v0 - 1 && g.km <= v1 + 1).map((g) => {
    const [nm, col] = SIM_GROUP[g.type] || ['Groupe', '#e5e7eb'], x = X(g.km), y = Y(profileAlt(P, g.km)), ly = Math.max(14, y - 20), label = `${g.name || nm} · ${g.riders ?? '?'}`;
    return `<g class="sim-g" data-simg="${esc(g.id)}"><title>${esc(label)}${g.gap != null ? ' · ' + simGap(g.gap) : ''}</title><line x1="${x}" y1="${ly}" x2="${x}" y2="${y}" stroke="${col}" stroke-width="1.5"/>
      <circle cx="${x}" cy="${ly}" r="3" fill="${col}"/><circle cx="${x}" cy="${y}" r="6.5" fill="${col}" stroke="#fff" stroke-width="1.8"/></g>`;
  }).join('');
  const startM = v0 <= 0.01 ? `<line x1="${X(0)}" y1="12" x2="${X(0)}" y2="${base}" stroke="#fff" stroke-width="1.4"/><circle cx="${X(0)}" cy="12" r="8" fill="#0b1020" stroke="#fff"/><path d="M${X(0) - 2} 8.5l5 3.5-5 3.5z" fill="#fff"/>` : '';
  const endM = v1 >= dist - 0.01 ? `<line x1="${X(dist)}" y1="12" x2="${X(dist)}" y2="${base}" stroke="#fff" stroke-width="1.4"/><circle cx="${X(dist)}" cy="12" r="8" fill="url(#simChk)" stroke="#fff"/>` : '';
  const now = currentKm >= v0 && currentKm <= v1 ? `<line x1="${X(currentKm)}" y1="${mt}" x2="${X(currentKm)}" y2="${base}" stroke="#fff" stroke-width="1" stroke-dasharray="3 3" opacity=".5"/>` : '';

  return `<div class="sim-ctl"><button type="button" data-simz="in" title="Zoom +">+</button><button type="button" data-simz="out" title="Zoom -">−</button><button type="button" data-simz="prev" title="Reculer">‹</button><button type="button" data-simz="next" title="Avancer">›</button>
      <button type="button" data-simz="lead">Centrer sur le leader</button><span class="muted">Zoom ×${z.toFixed(1)} · km ${v0.toFixed(0)} à ${v1.toFixed(0)} sur ${dist}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="sim-svg" role="img" aria-label="Profil de la course ${esc(P.name)}"><defs>
      <linearGradient id="simSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0f172a"/></linearGradient>
      <linearGradient id="simTerrain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eab308" stop-opacity=".9"/><stop offset="1" stop-color="#422006" stop-opacity=".95"/></linearGradient>
      <pattern id="simChk" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#fff"/><rect width="3" height="3" fill="#111"/><rect x="3" y="3" width="3" height="3" fill="#111"/></pattern>
      <symbol id="simWind" viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" fill="none" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round"/></symbol></defs>
      <rect width="${W}" height="${H}" rx="8" fill="url(#simSky)"/><path d="${area}" fill="url(#simTerrain)"/>${cobbles}${wind}
      ${runs.map((r) => `<path d="${r.d}" fill="none" stroke="${r.col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      <line x1="${ml}" y1="${base}" x2="${W - mr}" y2="${base}" stroke="#475569"/>${bars}${labels}
      ${ticks.map((k) => `<line x1="${X(k)}" y1="${base}" x2="${X(k)}" y2="${base + 4}" stroke="#64748b"/><text x="${X(k)}" y="${base + 33}" text-anchor="middle" font-size="10" fill="#94a3b8">${k}</text>`).join('')}
      ${v1 >= dist - 0.01 ? `<text x="${W - mr}" y="${base + 44}" text-anchor="end" font-size="10" fill="#cbd5e1">${dist} km</text>` : ''}
      ${now}${startM}${endM}${pins}${marks}</svg>
    <div class="sim-legend"><span><i style="background:#fde68a"></i>Plat</span><span><i style="background:#facc15"></i>2-4 %</span><span><i style="background:#fb923c"></i>5-7 %</span><span><i style="background:#dc2626"></i>8 % et +</span>
      <span><i style="background:#f43f5e"></i>Col</span><span><i style="background:#10b981"></i>Sprint (S)</span><span><i style="background:#b45309"></i>Pavés</span><span><i style="background:#38bdf8"></i>Vent / bordures</span></div>`;
}
// Monte le profil dans un conteneur et gère zoom + / zoom − / navigation / centrage sur le leader. Le moteur de course appellera update() à chaque tick.
function mountRaceProfile(el, profile, getState, onGroup) {
  const view = { zoom: 1, center: null, follow: false }, st = () => getState() || {};
  const leadKm = () => Math.max(st().currentKm || 0, ...(st().groups || []).map((g) => g.km || 0));
  const draw = () => { el.innerHTML = renderRaceProfileSVG(profile, st().currentKm || 0, st().groups || [], view); };
  el.onclick = (e) => {
    const b = e.target.closest('[data-simz]'), g = e.target.closest('[data-simg]');
    if (g && onGroup) return onGroup(g.dataset.simg);
    if (!b) return;
    const a = b.dataset.simz, span = profile.km / view.zoom, cur = view.follow || view.center == null ? (view.zoom > 1 ? leadKm() : profile.km / 2) : view.center;
    if (a === 'in') { view.zoom = Math.min(10, view.zoom * 1.5); view.center = cur; }
    else if (a === 'out') { view.zoom = Math.max(1, view.zoom / 1.5); view.center = cur; }
    else if (a === 'prev' || a === 'next') { view.center = cur + (a === 'next' ? 1 : -1) * span * 0.4; view.follow = false; }
    else if (a === 'lead') { view.follow = true; view.center = leadKm(); if (view.zoom < 2) view.zoom = 3; }
    draw();
  };
  draw();
  return { view, update: draw };
}

// Écran de démonstration (non utilisé : l'écran réel est renderLiveRaceDashboard dans raceEngine.js)
async function renderRaceLive(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const { data } = await sb.from('races').select('*').order('date'), races = data || [];
  if (!races.length) { c.innerHTML = '<div class="panel"><h4>Course en direct</h4><p class="muted">Aucune course au calendrier.</p></div>'; return; }
  const pick = (state.simRace && races.find((r) => r.id === state.simRace)) || (state.nextRace && races.find((r) => r.id === state.nextRace.id)) || races[0], P = generateRaceProfile(pick);
  state.simRace = pick.id;
  c.innerHTML = `<div class="sim-layout"><div><div class="panel"><h4>Instructions</h4><p class="muted">Les ordres aux coureurs arriveront à l'étape suivante.</p></div>
      <div class="panel"><h4>Journal de la course en direct</h4><p class="muted">Le journal s'affichera ici.</p></div></div>
      <div><div class="panel"><h4>Profil de la course en direct</h4>
      <div class="sq-bar"><div class="sq-ctl">${selHtml('sim-race', races.map((r) => [r.id, `${r.name} (${PROFILES[r.profile_type] || r.profile_type})`]), pick.id)}</div>
        <div class="muted">${P.km} km · ${P.climbs.length} col(s) · ${P.sprints.length} sprint(s) · ${P.cobbles.length} secteur(s) pavé(s) · ${P.wind.length} zone(s) de vent</div></div>
      <div id="sim-profile"></div><label style="margin-top:.5rem">Position de la course (démo) : <b id="sim-pos-v"></b> km</label><input id="sim-pos" type="range" min="0" max="${P.km}" step="0.5" value="${Math.round(P.km * 0.35)}"></div>
      <div class="panel"><h4>Mon équipe</h4><p class="muted">Les coureurs de votre équipe apparaîtront ici.</p></div></div></div>`;
  const groupsAt = (km) => [
    { id: 'break', type: 'BREAK', riders: 4, km: Math.min(P.km, km + 3), gap: 0 }, { id: 'pel', type: 'PELOTON', riders: 118, km, gap: 90 },
    { id: 'chase', type: 'CHASE', riders: 6, km: Math.max(0, km - 1.2), gap: 150 }, { id: 'drop', type: 'DROPPED', riders: 12, km: Math.max(0, km - 3.5), gap: 300 }];
  let pos = +$('sim-pos').value;
  const m = mountRaceProfile($('sim-profile'), P, () => ({ currentKm: pos + 3, groups: groupsAt(pos) }));
  $('sim-pos-v').textContent = pos;
  $('sim-pos').oninput = (e) => { pos = +e.target.value; $('sim-pos-v').textContent = pos; m.update(); };
  $('sim-race').onchange = (e) => { state.simRace = e.target.value; renderRaceLive(c); };
}

/* ===== Étape générée depuis une image de profil ===== */
// Analyse l'image : contour du relief (vert foncé lu de bas en haut, ou jaune-orange), échelle d'altitude calée sur les étiquettes « 689m » de l'image
function simAnalyzeProfileImage(img, dist, altMin, altMax, extra = {}) {
  const W = Math.min(1600, img.naturalWidth), Hh = Math.round((img.naturalHeight * W) / img.naturalWidth), cv = document.createElement('canvas');
  cv.width = W; cv.height = Hh; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, Hh); cx.drawImage(img, 0, 0, W, Hh);
  const px = cx.getImageData(0, 0, W, Hh).data;
  const isG = (r, g, b) => g > 110 && g > r + 8 && g > b + 35, isW = (r, g, b) => r > 45 && r - b > 22 && g >= b && r >= g - 10, isP = (r, g, b) => r > 170 && b > g + 25 && g < 120;
  let ng = 0, nw = 0; for (let i = 0; i < px.length; i += 16) { if (isG(px[i], px[i + 1], px[i + 2])) ng++; else if (isW(px[i], px[i + 1], px[i + 2])) nw++; }
  const warm = nw > ng;                                                                            // relief jaune-orange sur fond sombre, sinon relief vert
  let dom = null;                                                                                  // vert foncé dominant = corps du relief (le vert clair du bord 3D est exclu)
  if (!warm) {
    const hist = new Map();
    for (let i = 0; i < px.length; i += 16) {
      const r = px[i], g = px[i + 1], b = px[i + 2]; if (!isG(r, g, b)) continue;
      const k = (r >> 4) * 65536 + (g >> 4) * 256 + (b >> 4), e = hist.get(k) || { c: 0, r: 0, g: 0, b: 0 }; e.c++; e.r += r; e.g += g; e.b += b; hist.set(k, e);
    }
    let best = null; hist.forEach((e) => { if (!best || e.c > best.c) best = e; });
    if (best) dom = [best.r / best.c, best.g / best.c, best.b / best.c];
  }
  const kind = (x, y) => {
    const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
    if (warm) return isW(r, g, b) ? 1 : 0;
    if (dom) { const a = r - dom[0], c = g - dom[1], d = b - dom[2]; return a * a + c * c + d * d < 900 ? 1 : 0; }
    return 0;
  };
  const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  const fill = (a) => { let last = -1; for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; if (last >= 0 && i - last > 1) for (let j = last + 1; j < i; j++) a[j] = a[last] + ((a[i] - a[last]) * (j - last)) / (i - last); last = i; } };
  const bad = 'Profil non détecté : utilisez une image avec un relief jaune-orange, vert ou gris bien visible.';
  let x0 = -1, x1 = -1, base = -1, rt = [];
  if (warm) {
    const top = new Array(W).fill(-1), bot = new Array(W).fill(-1);
    for (let x = 0; x < W; x++) for (let y = 0; y < Hh - 2; y++) {
      if (!(kind(x, y) && kind(x, y + 1))) continue;
      let b = y; while (b < Hh - 1 && (kind(x, b + 1) || kind(x, b + 2))) b++;
      top[x] = y; bot[x] = b; break;
    }
    const v = (x) => top[x] >= 0 && bot[x] - top[x] >= 1;
    for (let x = 0; x < W - 10 && x0 < 0; x++) { let good = true; for (let k = 0; k < 10; k++) if (!v(x + k)) { good = false; break; } if (good) x0 = x; }
    for (let x = W - 1; x >= 10 && x1 < 0; x--) { let good = true; for (let k = 0; k < 10; k++) if (!v(x - k)) { good = false; break; } if (good) x1 = x; }
    if (x0 < 0 || x1 <= x0 + 20) throw new Error(bad);
    const rb = []; for (let x = x0; x <= x1; x++) { rt.push(v(x) ? top[x] : null); rb.push(v(x) ? bot[x] : null); }
    fill(rt); fill(rb); base = med(rb);
  } else {
    if (!dom) throw new Error(bad);
    const xs = Math.round(W * 0.03), xe = Math.round(W * 0.97), tot = Math.ceil((xe - xs) / 2);
    for (let y = Hh - 1; y > Hh * 0.35; y--) { let c = 0; for (let x = xs; x < xe; x += 2) if (kind(x, y)) c++; if (c >= tot * 0.3) { base = y; break; } }   // ligne de base = dernière rangée de vert foncé
    if (base < 0) throw new Error(bad);
    const colTop = (x) => {   // montée depuis la base tant que c'est du vert foncé (tolère 3 px de trait fin) ; colonne coupée par un trait de repère = invalide
      let y = base - 2; if (!kind(x, y) && !kind(x, y - 1)) return null;
      let top = y, gap = 0;
      for (; y > 0; y--) { if (kind(x, y)) { top = y; gap = 0; } else if (++gap > 3) break; }
      return top;
    };
    const raw = []; for (let x = 0; x < W; x++) raw.push(colTop(x));
    const val = raw.map((t) => t != null);
    for (let x = 0; x < W - 10 && x0 < 0; x++) { let c = 0; for (let k = 0; k < 10; k++) if (val[x + k]) c++; if (c >= 7 && val[x]) x0 = x; }
    for (let x = W - 1; x >= 10 && x1 < 0; x--) { let c = 0; for (let k = 0; k < 10; k++) if (val[x - k]) c++; if (c >= 7 && val[x]) x1 = x; }
    if (x0 < 0 || x1 <= x0 + 20) throw new Error(bad);
    rt = raw.slice(x0, x1 + 1); fill(rt);   // colonnes invalides : reconstituées entre leurs voisines
  }
  const win = warm ? 1 : 2, tops = rt.map((_, i) => med(rt.slice(Math.max(0, i - win), Math.min(rt.length, i + win + 1))));
  const n = tops.length, kmOf = (i) => (i / (n - 1)) * dist, clampI = (v) => Math.max(0, Math.min(n - 1, v));

  // Pavés : uniquement si la case est cochée (zones grises pleines sur toute la hauteur)
  const cobbles = [];
  if (extra.cob && !warm) {
    const isGr = (x, y) => { const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2]; return Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r >= 95 && r <= 205; };
    const g0 = tops.map((_, i) => (isGr(x0 + i, base - 3) && isGr(x0 + i, base - 8) ? 1 : 0)), gr = g0.map((_, i) => { let s = 0; for (let j = i - 2; j <= i + 2; j++) s += g0[j] || 0; return s >= 4 ? 1 : 0; });
    let st = -1;
    for (let i = 0; i <= n; i++) {
      if (gr[i]) { if (st < 0) st = i; continue; }
      if (st >= 0) { const f = kmOf(st), t = kmOf(i), last = cobbles[cobbles.length - 1]; if (last && f - last.to < 0.5) last.to = +t.toFixed(1); else cobbles.push({ from: +f.toFixed(1), to: +t.toFixed(1) }); st = -1; }
    }
  }

  // Étalonnage vertical : étiquettes d'altitude lues sur l'image (régression, valeurs aberrantes écartées), sinon axe lu, sinon vos altitudes min / max
  const fit = (ps) => { const m = ps.length, sy = ps.reduce((s, p) => s + p[0], 0), sv = ps.reduce((s, p) => s + p[1], 0), syy = ps.reduce((s, p) => s + p[0] * p[0], 0), syv = ps.reduce((s, p) => s + p[0] * p[1], 0), d = m * syy - sy * sy; if (!d) return null; const a = (m * syv - sy * sv) / d; return { a, b: (sv - a * sy) / m }; };
  let cal = extra.manualScale ? null : extra.cal, inl = [];
  const A0 = extra.manualScale ? [] : (extra.auto || []).map((a) => ({ km: +(a.f * dist).toFixed(2), alt: a.alt, y: tops[clampI(Math.round(a.f * (n - 1)))] }));
  if (A0.length >= 4) {
    let ps = A0.slice(), f = fit(ps.map((p) => [p.y, p.alt]));
    for (let it = 0; f && it < 12 && ps.length >= 4; it++) {
      const errs = ps.map((p) => Math.abs(f.a * p.y + f.b - p.alt)), mx = Math.max(...errs); if (mx <= 70) break;
      ps.splice(errs.indexOf(mx), 1); f = ps.length >= 2 ? fit(ps.map((p) => [p.y, p.alt])) : null;
    }
    if (f && ps.length >= 4 && f.a < 0 && ps.every((p) => Math.abs(f.a * p.y + f.b - p.alt) <= 70)) { cal = f; inl = ps; }
  }
  if (!inl.length && cal) inl = A0.filter((p) => Math.abs(cal.a * p.y + cal.b - p.alt) < 120);

  const N = Math.min(700, n - 1), hs = tops.map((t) => base - t), hmin = Math.min(...hs), span = Math.max(1, Math.max(...hs) - hmin), points = [];
  for (let s = 0; s <= N; s++) {
    const a = Math.max(0, Math.floor(((s - 0.5) / N) * (n - 1))), b = Math.min(n - 1, Math.ceil(((s + 0.5) / N) * (n - 1)));
    let sum = 0, c = 0; for (let i = a; i <= b; i++) { sum += tops[i]; c++; }
    const ty = sum / c;
    points.push([+((s / N) * dist).toFixed(2), cal ? Math.max(0, Math.round(cal.a * ty + cal.b)) : Math.round(altMin + ((base - ty - hmin) / span) * (altMax - altMin))]);
  }

  const marks = [];   // barres roses sous le profil = emplacement des cols (images jaune-orange)
  if (warm) {
    let yb = -1; for (let y = Hh - 1; y >= 0 && yb < 0; y--) { let c = 0; for (let x = x0; x <= x1; x++) if (isP(px[(y * W + x) * 4], px[(y * W + x) * 4 + 1], px[(y * W + x) * 4 + 2])) c++; if (c >= 6) yb = y; }
    if (yb >= 0) {
      const col = []; for (let x = x0; x <= x1; x++) col.push([yb - 1, yb, yb + 1].some((y) => y >= 0 && y < Hh && isP(px[(y * W + x) * 4], px[(y * W + x) * 4 + 1], px[(y * W + x) * 4 + 2])) ? 1 : 0);
      let s = -1, gap = 0;
      for (let i = 0; i <= col.length; i++) {
        if (col[i]) { if (s < 0) s = i; gap = 0; continue; }
        if (s >= 0 && ++gap > 2) { const e = i - gap; if (e - s >= 2) marks.push({ from: +kmOf(s).toFixed(1), to: +kmOf(e + 1).toFixed(1) }); s = -1; gap = 0; }
      }
    }
  }

  // Points d'altitude imposés : les vôtres + ceux lus sur l'image (correction interpolée entre les points, la forme est conservée)
  const anc = (extra.anchors || []).map((a) => ({ km: a.km, alt: a.alt }));
  inl.forEach((p) => { if (!anc.some((a) => Math.abs(a.km - p.km) < 1)) anc.push({ km: p.km, alt: p.alt }); });
  if (!anc.length && cal && extra.ends && !extra.manualScale) {   // altitudes de départ et d'arrivée lues sous le titre
    const e0 = extra.ends.s - points[0][1], e1 = extra.ends.e - points[points.length - 1][1];
    if (Math.abs(e0) < 120 && Math.abs(e1) < 120) anc.push({ km: 0, alt: extra.ends.s }, { km: dist, alt: extra.ends.e });
  }
  if (anc.length) {
    const A = anc.map((a) => { const i = points.reduce((b, p, k) => (Math.abs(p[0] - a.km) < Math.abs(points[b][0] - a.km) ? k : b), 0); return { km: points[i][0], off: a.alt - points[i][1] }; }).sort((p, q) => p.km - q.km);
    points.forEach((p) => {
      let o; const j = A.findIndex((a) => a.km >= p[0]);
      if (j === 0) o = A[0].off; else if (j < 0) o = A[A.length - 1].off; else { const a0 = A[j - 1], a1 = A[j]; o = a1.km === a0.km ? a1.off : a0.off + ((a1.off - a0.off) * (p[0] - a0.km)) / (a1.km - a0.km); }
      p[1] = Math.max(0, Math.round(p[1] + o));
    });
  }
  const pa = points.map((p) => p[1]), icons = (extra.icons || []).map((i) => ({ ...i, km: +(i.f * dist).toFixed(1) })), fixed = cal || anc.length;
  return { km: dist, altMin: fixed ? Math.min(...pa) : altMin, altMax: fixed ? Math.max(...pa) : altMax, calibrated: !!fixed, points, cobbles, marks, icons, manual: !!extra.manual, anchors: extra.anchors || [], geo: { W, Hh, x0, x1, base, tops, dist, used: inl } };
}

// Aperçu de contrôle : image d'origine, contour détecté (rouge), altitudes lues (jaune)
function simTraceHTML(img, g) {
  const cv = document.createElement('canvas'); cv.width = g.W; cv.height = g.Hh; const c = cv.getContext('2d');
  c.drawImage(img, 0, 0, g.W, g.Hh); c.strokeStyle = '#ef4444'; c.lineWidth = 2; c.beginPath();
  g.tops.forEach((t, i) => (i ? c.lineTo(g.x0 + i, t) : c.moveTo(g.x0 + i, t))); c.stroke();
  c.strokeStyle = '#3b82f6'; c.lineWidth = 1; c.beginPath(); c.moveTo(g.x0, g.base); c.lineTo(g.x1, g.base); c.stroke();
  c.font = 'bold 12px Arial'; c.textAlign = 'center';
  (g.used || []).forEach((p) => { const x = g.x0 + (p.km / g.dist) * (g.tops.length - 1); c.fillStyle = '#facc15'; c.beginPath(); c.arc(x, p.y, 4, 0, 6.3); c.fill(); c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText(p.alt + ' m', x, p.y - 8); c.fillText(p.alt + ' m', x, p.y - 8); });
  return `<div class="muted" style="font-size:.78rem;margin:.4rem 0 .2rem">Contrôle de lecture : trait rouge = contour détecté (vert foncé), points jaunes = altitudes lues sur l'image (${(g.used || []).length}).</div><img src="${cv.toDataURL('image/jpeg', 0.7)}" alt="" style="width:100%;border-radius:6px;margin-bottom:.5rem">`;
}

// Construit le profil complet (cols, sprints, pavés, vent) à partir des points enregistrés
function simProfileFromData(race) {
  const D = race.profile_data, dist = Number(race.distance_km) || D.km, pts = D.points, type = race.profile_type || D.type || 'FLAT', n = pts.length;
  const rng = simRng(String(race.id || race.name || 'etape') + type), R = (a, b) => a + rng() * (b - a), I = (a, b) => Math.floor(R(a, b + 1)), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ov = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const sm = pts.map((p, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) { s += pts[j][1]; c++; } return s / c; });
  const rangeA = Math.max(20, (D.altMax ?? 150) - (D.altMin ?? 0)), T = Math.max(8, rangeA * 0.035), climbs = [];
  if (D.manual || D.icons?.some((i) => i.kind === 'climb')) {   // cols lus sur l'image ou placés à la main : aucune détection automatique
    (D.icons || []).filter((i) => i.kind === 'climb').forEach((ic) => {
      let s = 0, best = -1e9; pts.forEach((p, i) => { if (Math.abs(p[0] - ic.km) <= 1 && sm[i] > best) { best = sm[i]; s = i; } });
      let vv = s; for (let i = s - 1; i >= 0 && pts[s][0] - pts[i][0] <= 25; i--) { if (sm[i] < sm[vv]) vv = i; else if (sm[i] - sm[vv] > T) break; }
      let nn = s; for (let i = s + 1; i < n; i++) { if (sm[i] < sm[nn]) nn = i; else if (sm[i] - sm[nn] > T) break; }
      const L = ic.len > 0 && ic.grad > 0, km = pts[s][0], len = L ? ic.len : Math.max(0.5, km - pts[vv][0]), gain = L ? Math.round(ic.len * 10 * ic.grad) : Math.max(10, Math.round(sm[s] - sm[vv])), start = L ? Math.max(0, km - len) : pts[vv][0];
      const cc = simCat(gain, len), cat = !ic.cat ? cc : ic.m ? ic.cat : (L && Math.abs(SIM_LV.indexOf(String(ic.cat)) - SIM_LV.indexOf(cc)) > 1 ? cc : ic.cat);   // catégorie de l'icône, sauf grosse incohérence
      climbs.push({ start, km, len, gain, grad: +(gain / (len * 10)).toFixed(1), dlen: km >= dist - 0.5 ? 0 : Math.max(2, pts[nn][0] - km), cat, name: ic.name || '', top: km >= dist - 0.5 });
    });
  } else {
    const ex = []; let mx = 0, mn = 0, up = null;
    for (let i = 1; i < n; i++) {
      const y = sm[i]; if (y > sm[mx]) mx = i; if (y < sm[mn]) mn = i;
      if (up !== false && sm[mx] - y >= T) { ex.push({ i: mx, t: 'max' }); up = false; mx = mn = i; }
      else if (up !== true && y - sm[mn] >= T) { ex.push({ i: mn, t: 'min' }); up = true; mx = mn = i; }
    }
    if (up === true && sm[mx] - sm[mn] >= T) ex.push({ i: mx, t: 'max' });
    ex.forEach((e, k) => {
      if (e.t !== 'max') return;
      const pv = ex.slice(0, k).reverse().find((x) => x.t === 'min'), nx = ex.slice(k + 1).find((x) => x.t === 'min'), vv = pv ? pv.i : 0;
      const start = pts[vv][0], km = pts[e.i][0], len = km - start, gain = Math.round(sm[e.i] - sm[vv]);
      if (gain < 80 || len < 1 || gain / (len * 10) < 3) return;
      climbs.push({ start, km, len, gain, grad: +(gain / (len * 10)).toFixed(1), dlen: km >= dist - 0.5 ? 0 : nx ? pts[nx.i][0] - km : Math.min(3, dist - km), cat: simCat(gain, len), top: km >= dist - 0.5 });
    });
  }
  const free = (k, wd) => !climbs.some((c) => ov(k - wd, k + wd, c.start - 1, c.km + c.dlen + 1));
  const place = (k0, wd) => { let k = clamp(k0, 15, dist - 8), t = 0; while (!free(k, wd) && t++ < 60) k += 1.5; return Math.min(k, dist - 6); };
  const ns = type === 'TIME_TRIAL' ? 0 : dist > 170 ? 2 : dist > 70 ? 1 : 0;
  const sprints = D.manual || D.icons?.length ? (D.icons || []).filter((i) => i.kind === 'sprint').map((i) => ({ km: i.km })) : Array.from({ length: ns }, (_, i) => ({ km: +place(dist * (ns === 1 ? R(0.45, 0.6) : i === 0 ? R(0.28, 0.4) : R(0.6, 0.72)), 1).toFixed(1) }));
  const cobbles = (D.cobbles || []).map((c, i, a) => ({ from: c.from, to: c.to, stars: clamp(Math.round(1 + (i / a.length) * 3 + R(-0.8, 1.2)), 1, 5), n: a.length - i }));
  cobbles.slice(-2).forEach((s) => (s.stars = Math.max(s.stars, 4)));
  const wind = [], nw = type === 'FLAT' || type === 'COBBLES' ? (dist < 100 ? 1 : I(1, 3)) : 0;
  for (let a = 0; a < 40 && wind.length < nw; a++) {
    const len = R(4, 12), from = R(dist * 0.2, Math.max(dist * 0.2 + 1, dist * 0.8 - len)), to = from + len;
    if (to > dist - 4 || climbs.some((c) => ov(from, to, c.start, c.km + c.dlen)) || cobbles.some((c) => ov(from, to, c.from - 1, c.to + 1)) || wind.some((x) => ov(from, to, x.from - 2, x.to + 2))) continue;
    wind.push({ from: +from.toFixed(1), to: +to.toFixed(1), dir: rng() < 0.5 ? 'L' : 'R' });
  }
  wind.sort((a, b) => a.from - b.from);
  const alts = pts.map((p) => p[1]);
  return { raceId: race.id, name: race.name || 'Étape', type, km: dist, points: pts, climbs, sprints, cobbles, wind, minAlt: Math.min(...alts), maxAlt: Math.max(...alts) };
}

/* ===== Lecteur de fichiers PCM .cds (CTStageData) ===== */
// Cherche dans le fichier les listes de paires (distance, altitude) en nombres décimaux 32 bits, et extrait les textes (nom de l'étape…)
async function simInflate(buf) {   // décompression d'un .zces : essaie plusieurs formats et décalages
  for (const off of [0, 2, 4, 8, 12, 16]) for (const fmt of ['deflate-raw', 'deflate', 'gzip']) {
    try {
      const out = await new Response(new Blob([buf.slice(off)]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer();
      if (out.byteLength > 2000) return out;
    } catch (e) { /* format suivant */ }
  }
  throw new Error('Fichier .zces non décompressé : utilisez le fichier .cds correspondant.');
}
async function simReadCds(file) {
  let buf0 = await file.arrayBuffer(); if (/\.zces$/i.test(file.name)) buf0 = await simInflate(buf0);
  const buf = buf0, dv = new DataView(buf), u8 = new Uint8Array(buf), n = buf.byteLength, strings = [];
  let s = '';
  for (let i = 0; i <= n; i++) { const c = i < n ? u8[i] : 0; if (c >= 32 && c < 127) s += String.fromCharCode(c); else { if (s.trim().length >= 4) strings.push(s.trim()); s = ''; } }
  const f = (o) => dv.getFloat32(o, true), runs = [];
  for (const swap of [false, true]) {   // paires (distance, altitude) ou (altitude, distance)
    let p = 0;
    while (p + 8 <= n) {
      let q = p, px = -Infinity; const pts = [];
      while (q + 8 <= n) {
        const a = f(q), b = f(q + 4), x = swap ? b : a, y = swap ? a : b;
        if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 1e6 || y < -300 || y > 6000 || x <= px) break;
        pts.push([x, y]); px = x; q += 8;
      }
      const ys = pts.map((t) => t[1]);
      if (pts.length >= 30 && Math.max(...ys) - Math.min(...ys) > 5) { runs.push({ off: p, swap, pts, x0: pts[0][0], x1: pts[pts.length - 1][0], ymin: Math.min(...ys), ymax: Math.max(...ys) }); p = q; } else p++;
    }
  }
  runs.sort((a, b) => b.pts.length - a.pts.length);
  const hdr = [];   // distances possibles écrites dans l'en-tête du fichier
  for (let o = 0; o < Math.min(n - 4, 400); o++) { const v = dv.getFloat32(o, true); if (!isFinite(v)) continue; if (v >= 20000 && v <= 300000) hdr.push(+(v / 1000).toFixed(1)); else if (v >= 20 && v <= 300 && Math.abs(v - Math.round(v)) < 1e-3) hdr.push(Math.round(v)); }
  return { strings, runs: runs.slice(0, 8), hdr: [...new Set(hdr)].slice(0, 6) };
}

// Admin : glisser une image de profil (ou un fichier .cds) + nom + date → l'étape est créée dans le calendrier
async function renderStageImport(c) {
  const TYPES = [['AUTO', 'Automatique'], ['FLAT', 'Plat'], ['HILLS', 'Vallonné'], ['MOUNTAIN', 'Montagne'], ['COBBLES', 'Pavés'], ['TIME_TRIAL', 'Contre-la-montre']], CATS = ['1.1', '1.Pro', '1.UWT', '2.1', '2.Pro', '2.UWT'].map((x) => [x, x]);
  c.innerHTML = `<div class="panel"><h4>Admin : importer le profil d'une étape</h4><div class="adm-grid">
      <div><label>Nom de l'étape</label><input id="si-name"></div><div><label>Date</label><input id="si-date" type="date" value="${state.game.game_date}"></div>
      <div><label>Distance (km)</label><input id="si-km" type="number" min="10" step="1" value="150"></div><div><label>Altitude minimale (m)</label><input id="si-amin" type="number" value="0"></div>
      <div><label>Altitude maximale (m)</label><input id="si-amax" type="number" value="150"></div><div><label>Type de course</label>${selHtml('si-type', TYPES, 'AUTO')}</div>
      <div><label>Catégorie</label>${selHtml('si-cat', CATS, '1.1')}</div><div><label>Distance de voyage (km)</label><input id="si-travel" type="number" min="0" value="0"></div>
      <div><label>Tag (ex. #tdf2026)</label><input id="si-tag" placeholder="#tdf2026"></div>
      <div><label>Détecter les pavés (zones grises, images)</label><input id="si-cob" type="checkbox"></div></div>
    <div id="si-drop" class="si-drop">Glissez ici l'image du profil (PNG ou JPG) ou un fichier PCM .cds, ou cliquez pour le choisir</div><input id="si-file" type="file" accept="image/*,.cds,.zces" hidden>
    <div id="si-prev"></div><div class="err" id="si-err"></div><div class="rov-btns"><button id="si-save" disabled>Générer l'étape</button></div></div>`;
  let img = null, P = null, D = null, info = null, cds = null; const val = (id) => $(id).value;
  const build = () => (cds ? buildCds() : buildImg());
  const buildImg = () => {
    if (!img) return; $('si-err').textContent = '';
    const mode0 = $('si-mode') ? $('si-mode').value : '3';
    try {
      const km = Math.max(10, Math.round(+val('si-km'))), { geo, ...D0 } = simAnalyzeProfileImage(img, km, +val('si-amin'), +val('si-amax'), { ...(info || {}), cob: $('si-cob').checked });
      const tmp = { name: val('si-name') || 'Étape', distance_km: km, profile_type: 'FLAT', profile_data: D0 };
      let type = val('si-type');
      if (type === 'AUTO') { const asc = simProfileFromData(tmp).climbs.reduce((s, x) => s + x.gain, 0); type = D0.cobbles.length >= 3 ? 'COBBLES' : asc / km < 8 ? 'FLAT' : asc / km < 22 ? 'HILLS' : 'MOUNTAIN'; }
      D = { ...D0, type }; P = simProfileFromData({ ...tmp, profile_type: type, profile_data: D });
      if (D0.calibrated && !(info && info.manualScale)) { $('si-amin').value = D0.altMin; $('si-amax').value = D0.altMax; }
      $('si-prev').innerHTML = `<div class="muted" style="margin:.6rem 0">${PROFILES[type] || type} · ${P.km} km · ${P.minAlt}-${P.maxAlt} m · ${P.climbs.length} col(s) · ${P.sprints.length} sprint(s) · ${P.cobbles.length} secteur(s) pavé(s) · ${P.wind.length} zone(s) de vent</div>
        <div class="muted" style="font-size:.78rem;margin-bottom:.4rem">${P.climbs.map((c) => `km ${c.km.toFixed(1)} : ${esc(c.name || 'Col')} (cat. ${c.cat}, +${c.gain} m, ${c.grad} %)`).join(' · ') || 'Aucun col détecté.'}${P.sprints.length ? ' · Sprints : km ' + P.sprints.map((s) => s.km).join(', ') : ''}</div>${simTraceHTML(img, geo)}${renderRaceProfileSVG(P, 0, [])}`;
      $('si-save').disabled = false;
      $('si-prev').insertAdjacentHTML('beforeend', siEditorHTML(P, (info && info.anchors) || [], mode0));
      siBindEditor(P, km, build, () => info, (d) => { info = info || {}; Object.assign(info, d, { manual: true }); });
    } catch (e) { P = null; $('si-save').disabled = true; $('si-prev').innerHTML = ''; $('si-err').textContent = e.message; }
  };
  // Profil issu d'un fichier .cds : altitudes exactes du fichier, cols détectés sur le relief puis corrigeables dans le tableau
   const buildCds = () => {
    $('si-err').textContent = '';
    try {
      const r = cds.runs[cds.sel], span = r.x1 - r.x0, div = span > 1000 ? 1000 : 1, kmRaw = span / div;
      const dist = cds.userKm ? Math.max(10, +val('si-km') || kmRaw) : Math.round(kmRaw * 10) / 10, f = dist / kmRaw, step = Math.max(1, Math.floor(r.pts.length / 700)), pts = [];
      for (let i = 0; i < r.pts.length; i += step) pts.push([+((((r.pts[i][0] - r.x0) / div) * f)).toFixed(3), r.pts[i][1]]);
      pts.push([dist, r.pts[r.pts.length - 1][1]]);
      let ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), note = '';
      if (cds.userAlt && hi > lo) { const a0 = +val('si-amin'), a1 = +val('si-amax'); pts.forEach((p) => (p[1] = a0 + ((p[1] - lo) * (a1 - a0)) / (hi - lo))); note = `Altitudes recalées entre ${a0} et ${a1} m (vos valeurs).`; }
      else { const mg = siMaxGrade({ points: pts }); if (mg > 16) { const k = 12 / mg; pts.forEach((p) => (p[1] = lo + (p[1] - lo) * k)); note = `Pentes irréalistes (${mg.toFixed(0)} % sur 2 km) : altitudes recalées ×${k.toFixed(2)}. Saisissez les vraies altitudes min et max pour les fixer.`; } }
      pts.forEach((p) => (p[1] = Math.round(p[1]))); ys = pts.map((p) => p[1]);
      if (!cds.userKm) $('si-km').value = dist;
      if (!cds.userAlt) { $('si-amin').value = Math.min(...ys); $('si-amax').value = Math.max(...ys); }
      const D0 = { km: dist, altMin: Math.min(...ys), altMax: Math.max(...ys), points: pts, cobbles: [], marks: [], icons: cds.icons, manual: cds.manual, anchors: [], calibrated: true };
      const tmp = { name: val('si-name') || 'Étape', distance_km: dist, profile_type: 'FLAT', profile_data: D0 };
      let type = val('si-type');
      if (type === 'AUTO') { const asc = simProfileFromData(tmp).climbs.reduce((s, x) => s + x.gain, 0); type = asc / dist < 8 ? 'FLAT' : asc / dist < 22 ? 'HILLS' : 'MOUNTAIN'; }
      D = { ...D0, type }; P = simProfileFromData({ ...tmp, profile_type: type, profile_data: D });
      const mode0 = $('si-mode') ? $('si-mode').value : '3', dopt = [[kmRaw, `Lue dans la liste : ${kmRaw.toFixed(1)} km`], ...(cds.hdr || []).map((v) => [v, `En-tête du fichier : ${v} km`])];
      $('si-prev').innerHTML = `<div class="sq-ctl" style="margin:.6rem 0;flex-wrap:wrap"><label style="margin:0">Liste de données :</label><select id="si-run">${cds.runs.map((q, i) => `<option value="${i}" ${i === cds.sel ? 'selected' : ''}>${i + 1}. ${q.pts.length} points · x ${Math.round(q.x0)} → ${Math.round(q.x1)} · altitude ${Math.round(q.ymin)} → ${Math.round(q.ymax)}${q.swap ? ' (inversé)' : ''}</option>`).join('')}</select>
          <label style="margin:0 0 0 .8rem">Distance :</label><select id="si-dist"><option value="">${dist} km (actuelle)</option>${dopt.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="muted" style="font-size:.78rem;margin-bottom:.4rem">${PROFILES[type] || type} · ${P.km} km · ${P.minAlt}-${P.maxAlt} m · pente max. ${siMaxGrade(P).toFixed(1)} % · ${P.climbs.length} col(s) · ${P.sprints.length} sprint(s)</div>
        ${note ? `<div class="down" style="font-size:.8rem;margin-bottom:.4rem">${note}</div>` : ''}${renderRaceProfileSVG(P, 0, [])}<div class="muted" style="font-size:.72rem;margin-top:.4rem">Textes trouvés dans le fichier : ${esc(cds.strings.slice(0, 40).join(' | '))}</div>`;
      $('si-run').onchange = (e) => { cds.sel = +e.target.value; build(); };
      $('si-dist').onchange = (e) => { if (!e.target.value) return; cds.userKm = true; $('si-km').value = e.target.value; build(); };
      $('si-save').disabled = false;
      $('si-prev').insertAdjacentHTML('beforeend', siEditorHTML(P, [], mode0));
      siBindEditor(P, dist, build, () => null, (d) => { cds.icons = d.icons; cds.manual = true; });
    } catch (e) { P = null; $('si-save').disabled = true; $('si-prev').innerHTML = ''; $('si-err').textContent = e.message; }
  };
  const loadCds = async (f) => {
    try {
      const r = await simReadCds(f);
      if (!r.runs.length) throw new Error('Aucun profil lisible dans ce fichier.');
      cds = { ...r, sel: 0, icons: [], manual: false }; img = null; info = null;
      const nm = r.strings.find((t) => / - /.test(t));
      if (nm) $('si-name').value = nm.replace(/\.$/, '');
      $('si-drop').textContent = 'Fichier .cds chargé : ' + f.name + ' (glissez-en un autre pour le remplacer)';
      build();
    } catch (e) { cds = null; P = null; $('si-save').disabled = true; $('si-err').textContent = e.message; }
  };
  const load = (f) => {
    if (f && /\.(cds|zces)$/i.test(f.name)) return loadCds(f);
    cds = null;
    if (!f || !f.type.startsWith('image/')) return;
    const im = new Image();
    im.onload = async () => {
      img = im; info = null; $('si-err').textContent = ''; $('si-drop').textContent = 'Lecture de l\'image : ' + f.name + '…';
      try {
        const g = simAnalyzeProfileImage(im, 100, 0, 150).geo;
        info = await simReadProfileText(im, g, (p) => ($('si-drop').textContent = `Lecture de l'image… ${p} %`));
        if (info.name) $('si-name').value = info.name;
        if (info.dist) $('si-km').value = info.dist;
      } catch (e) { $('si-err').textContent = 'Lecture automatique impossible (' + e.message + ') : saisie manuelle.'; }
      $('si-drop').textContent = 'Image chargée : ' + f.name + ' (glissez-en une autre pour la remplacer)'; build();
    };
    im.src = URL.createObjectURL(f);
  };
  const dz = $('si-drop');
  dz.onclick = () => $('si-file').click(); $('si-file').onchange = (e) => load(e.target.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('on'); }; dz.ondragleave = () => dz.classList.remove('on');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('on'); load(e.dataTransfer.files[0]); };
  ['si-type', 'si-name'].forEach((id) => ($(id).oninput = build)); $('si-cob').onchange = build;
  $('si-km').oninput = () => { if (cds) cds.userKm = true; build(); };
    ['si-amin', 'si-amax'].forEach((id) => ($(id).oninput = () => { if (cds) cds.userAlt = true; info = info || {}; info.cal = null; info.manualScale = true; build(); })); info.cal = null; info.manualScale = true; build(); }));
  $('si-save').onclick = async () => {
    const name = val('si-name').trim(), date = val('si-date'), err = $('si-err'); err.textContent = '';
    if (!name || !date || !P) return (err.textContent = 'Nom, date et profil (image ou fichier .cds) sont obligatoires.');
    $('si-save').disabled = true;
    const { error } = await sb.from('races').insert({ name, date, status: 'SCHEDULED', profile_type: P.type, distance_km: P.km, elevation_m: Math.round(P.climbs.reduce((s, x) => s + x.gain, 0)), category: val('si-cat'), travel_km: +val('si-travel') || 0, tag: siTag(val('si-tag')), profile_data: D });
    if (error) { $('si-save').disabled = false; return (err.textContent = error.message); }
    toast(`Étape « ${name} » créée le ${fmtShort(date)}.`); await loadGame();
  };
}

/* ===== Lecture automatique de l'image : texte (OCR), échelle d'altitude, altitudes des repères, icônes de cols et de sprints ===== */
function simPixelsOf(img, W) {
  const Hh = Math.round((img.naturalHeight * W) / img.naturalWidth), cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, Hh); cx.drawImage(img, 0, 0, W, Hh);
  return { W, Hh, px: cx.getImageData(0, 0, W, Hh).data };
}
// Carrés bleu marine (icônes de col et de sprint) : composantes connexes de pixels bleu marine
function simFindIcons(img, g) {
  const { W, Hh, px } = simPixelsOf(img, g.W), isN = (p) => { const i = p * 4; return px[i + 2] - px[i] > 18 && px[i + 2] > 45 && px[i + 2] < 160 && px[i] < 85 && px[i + 1] < 105 && px[i + 1] < px[i + 2]; };
  const y0 = Math.round(Hh * 0.12), y1 = Math.round(Hh * 0.82), seen = new Uint8Array(W * Hh), out = [], lo = W * 0.018, hi = W * 0.07;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (seen[p] || !isN(p)) continue;
    let a = x, b = x, c = y, d = y, n = 0; const st = [p]; seen[p] = 1;
    while (st.length) {
      const q = st.pop(), qx = q % W, qy = (q - qx) / W; n++; if (qx < a) a = qx; if (qx > b) b = qx; if (qy < c) c = qy; if (qy > d) d = qy;
      for (const [nx, ny] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]]) { if (nx < 0 || nx >= W || ny < y0 || ny >= y1) continue; const nq = ny * W + nx; if (!seen[nq] && isN(nq)) { seen[nq] = 1; st.push(nq); } }
    }
    const w = b - a + 1, h = d - c + 1; if (w < lo || w > hi || h < lo || h > hi || n < w * h * 0.45) continue;
    let wt = 0, wl = 0; for (let yy = c; yy <= d; yy++) for (let xx = a; xx <= b; xx++) { const i = (yy * W + xx) * 4; if (px[i] > 190 && px[i + 1] > 190 && px[i + 2] > 190) { wt++; if (xx < a + w * 0.32) wl++; } }
    out.push({ x0: a, x1: b, y0: c, y1: d, cx: (a + b) / 2, left: wt ? wl / wt : 0 });
  }
  return out;
}
function simIconCrop(img, g, ic) {   // intérieur de l'icône en noir sur blanc, agrandi 4 fois
  const k = img.naturalWidth / g.W, S = 4, ix = (ic.x1 - ic.x0) * 0.14, iy = (ic.y1 - ic.y0) * 0.14, sx = ic.x0 + ix, sy = ic.y0 + iy, sw = ic.x1 - ic.x0 - 2 * ix, sh = ic.y1 - ic.y0 - 2 * iy;
  const cv = document.createElement('canvas'); cv.width = Math.round(sw * S); cv.height = Math.round(sh * S); const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, sx * k, sy * k, sw * k, sh * k, 0, 0, cv.width, cv.height);
  const d = cx.getImageData(0, 0, cv.width, cv.height); for (let i = 0; i < d.data.length; i += 4) { const v = d.data[i] > 170 && d.data[i + 1] > 170 && d.data[i + 2] > 170 ? 0 : 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; }
  cx.putImageData(d, 0, 0); return cv;
}

async function simReadProfileText(img, g, onProgress) {
  if (typeof Tesseract === 'undefined') throw new Error('module OCR non chargé (balise tesseract.js absente de index.html)');
  const { W, Hh, x0, x1, base, tops } = g, S = 2, cv = document.createElement('canvas'); cv.width = W * S; cv.height = Hh * S;
  const c2 = cv.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, cv.width, cv.height); c2.drawImage(img, 0, 0, cv.width, cv.height);
  const icons = simFindIcons(img, g), wk = await Tesseract.createWorker('eng', 1, { logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100)); } });
  let words = [];
  try {
    await wk.setParameters({ tessedit_pageseg_mode: '11' });
    const { data } = await wk.recognize(cv);
    words = (data.words || []).map((w) => ({ t: String(w.text).trim(), x0: w.bbox.x0 / S, x1: w.bbox.x1 / S, y0: w.bbox.y0 / S, y1: w.bbox.y1 / S })).filter((w) => w.t).map((w) => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }));
    await wk.setParameters({ tessedit_pageseg_mode: '10', tessedit_char_whitelist: '1234HC' });
    for (const ic of icons) { try { ic.txt = ((await wk.recognize(simIconCrop(img, g, ic))).data.text || '').replace(/\s/g, ''); } catch (e) { ic.txt = ''; } }
  } finally { await wk.terminate(); }

  const isNum = (t) => /^\d+([.,]\d+)?$/.test(t), num = (t) => parseFloat(t.replace(',', '.'));
  // Distance : plus grand repère kilométrique à droite de l'axe
  const kmW = words.filter((w) => isNum(w.t) && w.cy > base - 0.05 * Hh && w.cy < Hh * 0.96 && w.cx >= x1 - 0.08 * W && w.cx <= x1 + 0.01 * W && num(w.t) >= 10 && num(w.t) <= 400);
  const dist = kmW.length ? Math.max(...kmW.map((w) => num(w.t))) : null;
  // Échelle d'altitude : repères 200, 400… des axes gauche et droit (régression : altitude = a × y + b)
  const fit = (ps) => { const n = ps.length, sy = ps.reduce((s, p) => s + p[0], 0), sv = ps.reduce((s, p) => s + p[1], 0), syy = ps.reduce((s, p) => s + p[0] * p[0], 0), syv = ps.reduce((s, p) => s + p[0] * p[1], 0), d = n * syy - sy * sy; if (!d) return null; const a = (n * syv - sy * sv) / d; return { a, b: (sv - a * sy) / n }; };
  const err = (f, p) => Math.abs(f.a * p[0] + f.b - p[1]);
  let ps = words.filter((w) => /^\d{3,4}$/.test(w.t) && +w.t % 50 === 0 && +w.t >= 50 && (w.x1 < x0 - 0.002 * W || w.x0 > x1 + 0.002 * W) && w.cy > 0.15 * Hh && w.cy < 0.95 * Hh).map((w) => [w.cy, +w.t]);
  let cal = ps.length >= 3 ? fit(ps) : null;
  if (cal && ps.length > 3 && Math.max(...ps.map((p) => err(cal, p))) > 60) { const worst = ps.reduce((m, p) => (err(cal, p) > err(cal, m) ? p : m)); ps = ps.filter((p) => p !== worst); cal = fit(ps); }
  if (cal && (cal.a >= 0 || Math.max(...ps.map((p) => err(cal, p))) > 80)) cal = null;
  // Secours : altitudes de départ et d'arrivée écrites sous le titre
  if (!cal) {
    const nt = words.filter((w) => w.cy < 0.12 * Hh && /^\d{2,4}$/.test(w.t)).sort((a, b) => a.cx - b.cx), s = nt[0], e = nt[nt.length - 1];
    if (s && e && s !== e) { const ys = tops[Math.min(2, tops.length - 1)], ye = tops[Math.max(0, tops.length - 3)], a = (+e.t - +s.t) / (ye - ys); if (Math.abs(ye - ys) > 15 && a < 0) cal = { a, b: +s.t - a * ys }; }
  }
  // Altitudes des repères : étiquettes « 404m », « 1265m »… placées au-dessus des traits verticaux (altitude exacte à ce kilomètre)
  const auto = words.filter((w) => w.cy > 0.12 * Hh && w.cy < 0.8 * Hh && /^\d{2,4}\s?(m|rn)$/i.test(w.t)).map((w) => ({ f: (w.cx - x0) / (x1 - x0), alt: parseInt(w.t, 10) })).filter((a) => a.f >= -0.01 && a.f <= 1.01 && a.alt >= 0 && a.alt <= 4000).map((a) => ({ ...a, f: Math.max(0, Math.min(1, a.f)) }));
  // Nom : « départ > arrivée », grands caractères du titre
  const T = words.filter((w) => w.cy < 0.115 * Hh && w.h >= 0.03 * Hh && /[A-Za-zÀ-ÿ]{2,}/.test(w.t) && w.cx > 0.03 * W && w.cx < 0.935 * W), join = (a) => a.sort((p, q) => p.cx - q.cx).map((w) => w.t).join(' ');
  const ns = join(T.filter((w) => w.cx < W / 2)), ne = join(T.filter((w) => w.cx >= W / 2)), name = ns && ne ? `${ns} > ${ne}` : ns || ne || '';
  // Libellés : lignes de texte rattachées à l'icône la plus proche
  const lines = [];
  words.filter((w) => w.cy > 0.12 * Hh && w.cy < 0.78 * Hh).sort((a, b) => a.cy - b.cy).forEach((w) => {
    const L = lines.find((l) => Math.abs(l.cy - w.cy) < 0.012 * Hh && w.x0 <= l.x1 + 0.02 * W && w.x1 >= l.x0 - 0.02 * W);
    if (L) { L.ws.push(w); L.x0 = Math.min(L.x0, w.x0); L.x1 = Math.max(L.x1, w.x1); } else lines.push({ cy: w.cy, x0: w.x0, x1: w.x1, ws: [w] });
  });
  const clean = (t) => t.replace(/\([^)]*%[^)]*\)/g, '').replace(/^\s*\d+\s*m\b[\s-]*/i, '').replace(/\s*\d+([.,]\d+)?\s*km.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const out = icons.filter((ic) => (ic.cx - x0) / (x1 - x0) > -0.03 && (ic.cx - x0) / (x1 - x0) < 1.03).map((ic) => {
    const digit = (ic.txt || '').match(/[1-4]/), hc = /H|C/.test(ic.txt || ''), kind = (!digit && !hc && ic.left > 0.2) || ic.left > 0.4 ? 'sprint' : 'climb';
    const mine = lines.filter((l) => { const m = (l.x0 + l.x1) / 2; return l.cy < ic.y0 && l.cy > ic.y0 - 0.2 * Hh && Math.abs(m - ic.cx) < 0.07 * W && icons.reduce((b, o) => (Math.abs(o.cx - m) < Math.abs(b.cx - m) ? o : b), icons[0]) === ic; }).sort((a, b) => a.cy - b.cy);
    const raw = mine.map((l) => l.ws.sort((a, b) => a.cx - b.cx).map((w) => w.t).join(' ')).join(' '), mm = raw.match(/(\d+(?:[.,]\d+)?)\s*km\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*%/i);   // « 5.2 Km - 6.7% »
    return { f: Math.max(0, Math.min(1, (ic.cx - x0) / (x1 - x0))), kind, cat: kind === 'climb' ? (hc ? 'HC' : digit ? digit[0] : null) : null, name: clean(raw), len: mm ? parseFloat(mm[1].replace(',', '.')) : null, grad: mm ? parseFloat(mm[2].replace(',', '.')) : null };
  }).sort((a, b) => a.f - b.f);
  const hd = words.filter((w) => w.cy < 0.12 * Hh && /^\d{2,4}$/.test(w.t) && w.h >= 0.02 * Hh), hl = hd.filter((w) => w.cx < W / 2).sort((a, b) => a.cx - b.cx)[0], hr = hd.filter((w) => w.cx >= W / 2).sort((a, b) => b.cx - a.cx)[0];
  return { name, dist, cal, icons: out, auto, ends: hl && hr ? { s: +hl.t, e: +hr.t } : null };
}

/* ===== Éditeur manuel : cols, sprints, points d'altitude ===== */
function siMaxGrade(P) {
  const pts = P.points; let mg = 0;
  for (let i = 0; i < pts.length; i++) { const j = pts.findIndex((p) => p[0] >= pts[i][0] + 2); if (j < 0) break; mg = Math.max(mg, (pts[j][1] - pts[i][1]) / ((pts[j][0] - pts[i][0]) * 10)); }
  return mg;
}
function siEditorHTML(P, anchors = [], mode = '3') {
  const cats = ['4', '3', '2', '1', 'HC'], mg = siMaxGrade(P), del = '<td><input data-sie="del" type="checkbox"></td>';
  const kmI = (v) => `<td><input data-sie="km" type="number" step="0.1" value="${(+v).toFixed(1)}" style="width:80px"></td>`;
  const row = (kind, km, cat, name, info, attrs = '') => `<tr data-sir="${kind}" ${attrs}><td>${kind === 'climb' ? 'Col' : 'Sprint'}</td>${kmI(km)}<td>${kind === 'climb' ? `<select data-sie="cat">${cats.map((c) => `<option ${c === String(cat) ? 'selected' : ''}>${c}</option>`).join('')}</select>` : '-'}</td>
    <td><input data-sie="name" value="${esc(name || '')}" style="width:170px"></td><td class="muted">${info || ''}</td>${del}</tr>`;
  const arow = (a) => `<tr data-sir="alt"><td>Altitude</td>${kmI(a.km)}<td><input data-sie="alt" type="number" step="1" value="${Math.round(a.alt)}" style="width:80px"> m</td><td class="muted">point d'altitude imposé</td><td></td>${del}</tr>`;
  const modes = [['3', 'Col de catégorie 3'], ['2', 'Col de catégorie 2'], ['1', 'Col de catégorie 1'], ['HC', 'Col hors catégorie'], ['4', 'Col de catégorie 4'], ['S', 'Sprint intermédiaire'], ['alt', "Point d'altitude"]];
  return `<div class="panel" style="margin-top:.7rem"><h4>Placement manuel des cols, sprints et altitudes</h4>
    <div class="sq-bar"><div class="sq-ctl"><label style="margin:0">Clic sur le profil = placer :</label>${selHtml('si-mode', modes, mode)}</div>
      <div class="stat-row" style="min-width:260px"><span>Pente max. sur 2 km</span><b class="${mg > 14 ? 'down' : 'up'}">${mg.toFixed(1)} %</b></div></div>
    <p class="muted" style="font-size:.82rem">Cliquez sur le profil ci-dessus pour poser un point à cet endroit. Un « point d'altitude » force l'altitude réelle à ce kilomètre (le reste du profil est recalé entre vos points). Modifiez ou supprimez les lignes dans le tableau.</p>
    ${mg > 14 ? '<button type="button" data-sie="fit">Ajuster l\'altitude max automatiquement</button>' : ''}
    <div class="tbl"><table class="fm sq"><thead><tr><th>Type</th><th>Km</th><th>Catégorie / altitude</th><th>Nom</th><th>Dénivelé / pente</th><th>Suppr.</th></tr></thead><tbody>
    ${P.climbs.map((c) => row('climb', c.km, c.cat, c.name, `+${c.gain} m · ${c.grad} %`, `data-len="${c.len.toFixed(2)}" data-grad="${c.grad}"`)).join('')}${P.sprints.map((s) => row('sprint', s.km, '', '', '')).join('')}${anchors.map(arow).join('')}</tbody></table></div>
    <div class="rov-btns"><button type="button" data-sie="addc">Ajouter un col</button><button type="button" data-sie="adds">Ajouter un sprint</button><button type="button" data-sie="adda">Ajouter un point d'altitude</button></div></div>`;
}
function siBindEditor(P, km, rebuild, getInfo, setData) {
  const box = $('si-prev'), cl = (v) => Math.max(0, Math.min(km, +v || 0)), q = (r, k) => r.querySelector(`[data-sie="${k}"]`);
  const read = () => {
    const rows = [...box.querySelectorAll('tr[data-sir]')].filter((r) => !q(r, 'del').checked);
    return { icons: rows.filter((r) => r.dataset.sir !== 'alt').map((r) => ({ kind: r.dataset.sir, f: cl(q(r, 'km').value) / km, cat: r.dataset.sir === 'climb' ? q(r, 'cat').value : null, name: q(r, 'name').value, len: +r.dataset.len || null, grad: +r.dataset.grad || null, m: true })),
      anchors: rows.filter((r) => r.dataset.sir === 'alt').map((r) => ({ km: cl(q(r, 'km').value), alt: Math.max(0, +q(r, 'alt').value || 0) })) };
  };
  const apply = (d) => { setData(d); rebuild(); };
  box.querySelectorAll('input[data-sie], select[data-sie]').forEach((el) => (el.onchange = () => apply(read())));
  box.querySelectorAll('button[data-sie]').forEach((b) => (b.onclick = () => {
    const a = b.dataset.sie, d = read();
    if (a === 'fit') { const amin = +$('si-amin').value, amax = +$('si-amax').value, mg = siMaxGrade(P); $('si-amax').value = Math.round(amin + ((amax - amin) * 11) / mg); const i = getInfo(); if (i) { i.cal = null; i.manualScale = true; } return apply(d); }
    if (a === 'addc') d.icons.push({ kind: 'climb', f: 0.5, cat: '3', name: '', m: true });
    else if (a === 'adds') d.icons.push({ kind: 'sprint', f: 0.5, cat: null, name: '', m: true });
    else d.anchors.push({ km: Math.round(km / 2), alt: Math.round(profileAlt(P, km / 2)) });
    apply(d);
  }));
  const svg = box.querySelector('svg.sim-svg');
  if (svg) {
    svg.style.cursor = 'crosshair';
    svg.onclick = (e) => {
      const r = svg.getBoundingClientRect(), k = Math.round(cl(((((e.clientX - r.left) * 1000) / r.width - 14) / 972) * km) * 10) / 10, m = $('si-mode').value, d = read();
      if (m === 'alt') { const v = prompt(`Altitude réelle (m) au km ${k} :`, Math.round(profileAlt(P, k))); if (v === null || isNaN(+v) || v === '') return; d.anchors.push({ km: k, alt: Math.max(0, +v) }); }
      else if (m === 'S') d.icons.push({ kind: 'sprint', f: k / km, cat: null, name: '', m: true });
      else d.icons.push({ kind: 'climb', f: k / km, cat: m, name: '', m: true });
      apply(d);
    };
  }
}

/* ===== Courses et tags (ex. #tdf2026) ===== */
const siTag = (t) => { const s = String(t || '').trim().toLowerCase().replace(/[^a-z0-9_àâçéèêëîïôûùüÿ]/g, ''); return s ? '#' + s : null; };

async function renderRaceManager(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const { data, error } = await sb.from('races').select('id, name, date, status, tag, distance_km, profile_type').order('date');
  if (error) { c.innerHTML = `<div class="panel"><p class="err">${esc(error.message)} : lancez le script SQL du tag dans Supabase.</p></div>`; return; }
  const races = data || [], tags = [...new Set(races.map((r) => r.tag).filter(Boolean))].sort(), f = state.rmTag || 'all';
  const rows = races.filter((r) => f === 'all' || (f === 'none' ? !r.tag : r.tag === f)), n = (t) => races.filter((r) => r.tag === t).length;
  c.innerHTML = `<div class="panel"><h4>Admin : courses et tags</h4>
    <div class="sq-bar"><div class="sq-ctl">${selHtml('rm-f', [['all', `Toutes les courses (${races.length})`], ['none', 'Sans tag'], ...tags.map((t) => [t, `${t} (${n(t)})`])], f)}</div>
      <div class="sq-ctl"><input id="rm-tag" placeholder="#tdf2026" style="width:140px"><button id="rm-apply">Appliquer aux courses cochées</button><button class="danger" id="rm-clear">Retirer le tag des cochées</button></div></div>
    <div class="tbl"><table class="fm sq"><thead><tr><th><input type="checkbox" id="rm-all"></th><th>Date</th><th>Course</th><th>Type</th><th>Km</th><th>Tag</th><th>Statut</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><input type="checkbox" data-rm="${r.id}"></td><td>${fmtShort(r.date)}</td><td>${esc(r.name)}</td><td>${PROFILES[r.profile_type] || r.profile_type || '-'}</td><td>${r.distance_km || '-'}</td><td>${r.tag ? `<span class="bd spec">${esc(r.tag)}</span>` : '-'}</td><td>${esc(r.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune course.</td></tr>'}</tbody></table></div></div>`;
  const ids = () => [...c.querySelectorAll('[data-rm]:checked')].map((x) => x.dataset.rm);
  $('rm-f').onchange = (e) => { state.rmTag = e.target.value; renderRaceManager(c); };
  $('rm-all').onchange = (e) => c.querySelectorAll('[data-rm]').forEach((x) => (x.checked = e.target.checked));
  const save = async (tag) => {
    const sel = ids(); if (!sel.length) return toast('Cochez au moins une course.');
    const { error: er } = await sb.from('races').update({ tag }).in('id', sel);
    if (er) return toast(er.message);
    toast(tag ? `Tag ${tag} appliqué à ${sel.length} course(s).` : 'Tag retiré.'); renderRaceManager(c);
  };
  $('rm-apply').onclick = () => { const t = siTag($('rm-tag').value); if (!t) return toast('Saisissez un tag (ex. #tdf2026).'); save(t); };
  $('rm-clear').onclick = () => save(null);
}
