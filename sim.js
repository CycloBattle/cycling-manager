// sim.js — Simulation 2D de course en direct : profil altimétrique (génération + rendu SVG)
// Utilise esc, $, sb, state, PROFILES (app.js) et selHtml (recruit.js)
const simCat = (gain) => (gain >= 900 ? 'HC' : gain >= 600 ? '1' : gain >= 350 ? '2' : gain >= 160 ? '3' : '4');
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
  const type = race.profile_type || 'FLAT', dist = Math.max(10, Number(race.distance_km) || 150), rng = simRng(String(race.id || race.name || 'course') + type);
  const R = (a, b) => a + rng() * (b - a), I = (a, b) => Math.floor(R(a, b + 1)), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ov = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const CFG = { FLAT: { base: [15, 60], n: [0, 1], elev: 250, max: 200, gr: [3, 6], amp: 8 }, COBBLES: { base: [20, 90], n: [0, 2], elev: 400, max: 200, gr: [3, 6], amp: 12 },
    HILLS: { base: [120, 320], n: [4, 7], elev: 2600, max: 450, gr: [4, 8], amp: 25 }, MOUNTAIN: { base: [350, 900], n: [3, 5], elev: 4200, max: 1400, gr: [5, 9], amp: 30 },
    TIME_TRIAL: { base: [10, 80], n: [0, 1], elev: 150, max: 120, gr: [3, 5], amp: 6 } };
  const cfg = CFG[type] || CFG.FLAT, elev = Number(race.elevation_m) || cfg.elev, n = Math.min(I(cfg.n[0], cfg.n[1]), Math.ceil(dist / 25));

  // Cols : un par tranche de parcours, durée = dénivelé / pente moyenne, catégorie selon le dénivelé
  const w = Array.from({ length: n }, () => R(0.6, 1.4)), ws = w.reduce((a, b) => a + b, 0) || 1;
  const lo = Math.min(10, dist * 0.08), hi = dist - Math.min(5, dist * 0.04), slot = (hi - lo) / Math.max(1, n), climbs = [];
  for (let i = 0; i < n; i++) {
    const gr = R(cfg.gr[0], cfg.gr[1]); let gain = Math.min(cfg.max, Math.max(50, (elev * 0.65 * w[i]) / ws)), len = gain / (10 * gr);
    if (len > slot / 1.7) { len = slot / 1.7; gain = len * 10 * gr; }
    const top = type === 'MOUNTAIN' && i === n - 1 && rng() < 0.5;                          // arrivée au sommet
    const start = top ? dist - len : lo + i * slot + R(0, Math.max(0, slot - len * 1.7));
    climbs.push({ start, km: start + len, len, gain: Math.round(gain), grad: +(gain / (len * 10)).toFixed(1), dlen: top ? 0 : len * 0.6, cat: simCat(gain), top });
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

  // Sprints intermédiaires (S) et ravitaillements (zones musette) : hors des cols
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
  return { raceId: race.id, name: race.name || 'Course', type, km: dist, points, climbs, sprints, feeds, cobbles, wind, minAlt: Math.min(...alts), maxAlt: Math.max(...alts) };
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
  const runs = []; let cur = null;                                                                    // ligne d'altitude colorée selon la pente
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
  const pins = P.climbs.map((c) => pin(c.km, c.cat, c.cat === 'HC' ? '#7f1d1d' : '#db2777', c.cat === 'HC' ? 11 : 9, `Col de catégorie ${c.cat} : ${c.len.toFixed(1)} km à ${c.grad} % (+${c.gain} m) · km ${c.km.toFixed(0)}`)).join('')
    + P.sprints.map((s, i) => pin(s.km, 'S', '#10b981', 9, `Sprint intermédiaire n°${i + 1} · km ${s.km}`)).join('');
  const marks = groups.filter((g) => g.km >= v0 - 1 && g.km <= v1 + 1).map((g, i) => {
    const [nm, col] = SIM_GROUP[g.type] || ['Groupe', '#e5e7eb'], x = X(g.km), y = Y(profileAlt(P, g.km)), ly = Math.max(12, y - 16 - (i % 3) * 13), label = `${g.name || nm} · ${g.riders ?? '?'}`;
    return `<g class="sim-g" data-simg="${esc(g.id)}"><title>${esc(label)}${g.gap != null ? ' · ' + simGap(g.gap) : ''}</title><line x1="${x}" y1="${ly + 3}" x2="${x}" y2="${y}" stroke="${col}" stroke-width="1.5"/>
      <circle cx="${x}" cy="${y}" r="6.5" fill="${col}" stroke="#fff" stroke-width="1.8"/><text x="${x}" y="${ly}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" stroke="#0b1020" stroke-width="3" paint-order="stroke">${esc(label)}</text></g>`;
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

// Écran de démonstration (PORTAIL → Compétitions) : choix de la course, profil généré, groupes déplaçables avec le curseur
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
