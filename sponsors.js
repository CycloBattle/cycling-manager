// sponsors.js — Contrats & Sponsors + projection budgétaire
// Utilise sb, state, esc, fmtEUR, NATS, $, viewGame (app.js) et Chart (Chart.js via CDN)
const GEAR_LABELS = { FRAME: 'Cadres', WHEELS: 'Roues', GROUPS: 'Transmissions', WEAR: 'Tenues', HELMET: 'Casques & lunettes', NUTRITION: 'Nutrition' };
const slotLabel = (k) => (k && k.startsWith('TITLE_') ? `Titre ${k.slice(-1)}` : GEAR_LABELS[k] || k);
const RACE_COST = 4500;   // hypothèse : frais d'engagement + déplacement par course
let sponsorChart = null;

// Registre d'objectifs : ajoutez une entrée ici + utilisez son "type" dans sponsors_catalog.objectives_json
// check() renvoie { met, pending, score(0-100), detail }
const OBJECTIVES = {
  NATIONALITY_QUOTA: {
    label: (o) => `Au moins ${o.min_pct}% de coureurs ${NATS[o.nationality] || o.nationality}`,
    check: (o, c) => {
      const n = c.riders.filter((r) => r.nationality === o.nationality).length;
      const pct = c.riders.length ? Math.round((n * 100) / c.riders.length) : 0;
      const score = Math.min(100, Math.round((pct * 100) / o.min_pct));
      return { met: score >= 100, pending: false, score, detail: `${pct}% actuellement` };
    },
  },
  VICTORIES_OR_PODIUMS: {
    label: (o) => [o.min_wins > 0 && `${o.min_wins} victoire(s)`, o.min_podiums > 0 && `${o.min_podiums} podium(s)`].filter(Boolean).join(' + ') + ' cette saison',
    check: (o, c) => {
      const w = c.results.filter((r) => r.position === 1).length, p = c.results.filter((r) => r.position <= 3).length;
      const parts = [];
      if (o.min_wins > 0) parts.push(Math.min(1, w / o.min_wins));
      if (o.min_podiums > 0) parts.push(Math.min(1, p / o.min_podiums));
      const ratio = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
      return { met: ratio >= 1, pending: ratio < 1, score: Math.round(ratio * 100), detail: `${w} victoire(s), ${p} podium(s)` };
    },
  },
  YOUTH_DEVELOPMENT: {
    label: (o) => `Au moins ${o.min_count} coureurs U${o.max_age + 1}`,
    check: (o, c) => {
      const n = c.riders.filter((r) => r.age <= o.max_age).length;
      const score = Math.min(100, Math.round((n * 100) / o.min_count));
      return { met: n >= o.min_count, pending: false, score, detail: `${n}/${o.min_count}` };
    },
  },
};

const s_isGearOnly = (x) => !!x.sponsors_catalog?.is_team_sponsor && !x.slot_type.startsWith('TITLE_');

function evaluateContract(contract, ctx) {
  const items = (contract.objectives || []).map((o) => {
    const def = OBJECTIVES[o.type];
    if (!def) return { text: `Objectif inconnu (${o.type})`, met: false, pending: true, score: 70, detail: '' };
    return { text: def.label(o), ...def.check(o, ctx) };
  });
  const sat = items.length ? Math.round(items.reduce((s, i) => s + (i.pending ? 70 : i.score), 0) / items.length) : 100;
  return { items, sat };
}

async function loadSponsorCtx() {
  const tid = state.team.id;
  const [riders, catalog, mine, races, staff, infra, gs, countries] = await Promise.all([
    sb.from('riders').select('id, nationality, age, contract_salary').eq('team_id', tid),
    sb.from('sponsors_catalog').select('*'),
    sb.from('team_sponsors').select('*, sponsors_catalog(*)').eq('team_id', tid).order('slot_type'),
    sb.from('races').select('date, status'),
    sb.from('staff').select('monthly_salary').eq('team_id', tid),
    sb.from('team_infrastructures').select('maintenance_cost').eq('team_id', tid),
    sb.from('game_state').select('game_date').eq('id', 1).single(),
    sb.from('countries').select('*'),
  ]);
  const ids = (riders.data || []).map((r) => r.id);
  const res = ids.length ? await sb.from('race_results').select('position').in('rider_id', ids) : { data: [] };
  return { riders: riders.data || [], catalog: catalog.data || [], mine: mine.data || [], races: races.data || [],
    staff: staff.data || [], infra: infra.data || [], gameDate: gs.data?.game_date, countries: countries.data || [], results: res.data || [] };
}

// Projection sur 12 mois : revenus sponsors - salaires - maintenance - frais de courses
function buildProjection(ctx) {
  const start = new Date(ctx.gameDate || Date.now()); start.setDate(1);
  const payroll = ctx.riders.reduce((s, r) => s + Number(r.contract_salary || 0), 0) + ctx.staff.reduce((s, x) => s + Number(x.monthly_salary || 0), 0);
  const maint = ctx.infra.reduce((s, x) => s + Number(x.maintenance_cost || 0), 0);
  const income = ctx.mine.reduce((s, x) => s + Number(x.monthly_payout) * (evaluateContract({ objectives: x.objectives }, ctx).sat < 40 ? 0.5 : 1), 0);
  let bal = Number(state.team.budget); const labels = [], data = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const n = ctx.races.filter((r) => { const rd = new Date(r.date); return r.status === 'SCHEDULED' && rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth(); }).length;
    bal += income - payroll - maint - n * RACE_COST;
    labels.push(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })); data.push(Math.round(bal));
  }
  return { labels, data, income, payroll, maint };
}

async function renderSponsors(c) {
  c.innerHTML = '<p class="muted">Chargement…</p>';
  if (sponsorChart) { sponsorChart.destroy(); sponsorChart = null; }
  const ctx = await loadSponsorCtx();
  const t = state.team, conti = t.division === 'CONTI_PRO';
  const titleSlots = conti ? ['TITLE_1', 'TITLE_2'] : ['TITLE_1', 'TITLE_2', 'TITLE_3'];
  const taken = new Set(ctx.mine.flatMap((x) => [x.slot_type, x.gear_slot].filter(Boolean)));
  const owned = new Set(ctx.mine.map((x) => x.sponsor_id));

  // Filtrage : grade 2 uniquement en Conti-Pro ; titres = pays de l'équipe (sinon même région si aucune offre locale)
  const visible = ctx.catalog.filter((s) => !conti || s.grade === 2);
  const localExists = visible.some((s) => s.is_team_sponsor && s.country_code === t.nationality);
  const myRegion = ctx.countries.find((x) => x.code === t.nationality)?.region;
  const titleOk = (s) => s.country_code === t.nationality || (!localExists && s.region === myRegion);
  // les cadres à double rôle restent visibles pour tous : ils peuvent être signés comme simple équipementier
  const offers = visible.filter((s) => !s.is_team_sponsor || titleOk(s) || s.gear_slot === 'FRAME')
    .sort((a, b) => Number(b.budget_amount) - Number(a.budget_amount));

  const lockReason = (s, gearOnly = false) => {
    if (owned.has(s.id)) return 'Déjà sous contrat';
    if (s.gear_slot && taken.has(s.gear_slot)) return `Slot ${GEAR_LABELS[s.gear_slot]} déjà occupé`;
    if (gearOnly || !s.is_team_sponsor) return null;
    if (s.gear_slot && taken.has('TITLE_2')) return 'Exige le slot Titre 2, déjà occupé';
    if (!s.gear_slot && !titleSlots.some((k) => !taken.has(k))) return 'Slots titres complets';
    return null;
  };

  const p = buildProjection(ctx);
  const firstNeg = p.data.findIndex((v) => v < 0);
  const monthly = ctx.mine.reduce((s, x) => s + Number(x.monthly_payout), 0);
  const kind = (s) => (s.is_team_sponsor ? (s.gear_slot ? `Titre 2 + ${GEAR_LABELS[s.gear_slot]}` : 'Sponsor titre') : GEAR_LABELS[s.gear_slot]);
  const money = (s) => `${s.free_gear ? 'Matériel gratuit + ' : ''}${fmtEUR(s.budget_amount || 0)} / an`;

  const contractCard = (x) => {
    const s = x.sponsors_catalog, gearOnly = s_isGearOnly(x), ev = evaluateContract(x, ctx), cls = ev.sat >= 70 ? 'ok' : ev.sat >= 40 ? 'warn' : 'bad';
    return `<div class="card contract">
      <div class="head"><b>${esc(s.name)}</b><span class="muted">${slotLabel(x.slot_type)}${x.gear_slot ? ' + ' + GEAR_LABELS[x.gear_slot] : ''} · jusqu'en ${x.contract_end_year}</span></div>
      <div>${fmtEUR(x.monthly_payout)} / mois${s.free_gear ? ' · matériel gratuit' : ''}</div>
      <label>Satisfaction : ${ev.sat}%</label><div class="bar ${cls}"><i style="width:${ev.sat}%"></i></div>
      ${ev.sat < 40 ? '<span class="badge bad">Sous 40% : dotation réduite de 50%, risque de résiliation</span>' : ''}
      <ul class="req">${ev.items.map((i) => `<li class="${i.met ? 'ok' : i.pending ? '' : 'ko'}">${i.met ? '✅' : i.pending ? '⏳' : '❌'} ${esc(i.text)} <span class="muted">(${esc(i.detail)})</span></li>`).join('')}</ul>
      ${gearOnly ? '<span class="badge">Équipementier seul : sans exigence</span>' : s.objectives_description ? `<div class="muted">Contrat : ${esc(s.objectives_description)}</div>` : ''}
      <button class="danger" data-end="${x.id}">Rompre (pénalité ${fmtEUR(x.monthly_payout * 3)})</button></div>`;
  };

  const offerCard = (s) => {
    const dualFrame = s.is_team_sponsor && s.gear_slot === 'FRAME';
    const btn = (label, mode, why) => `<button data-sign="${s.id}" data-mode="${mode}" ${why ? 'disabled' : ''}>${label}</button>${why ? `<div class="muted">${esc(why)}</div>` : ''}`;
    if (dualFrame) {
      const titleWhy = lockReason(s) || (titleOk(s) ? null : 'Titre 2 réservé aux sponsors de votre pays');
      return `<div class="card offer">
        <div class="head"><b>${esc(s.name)}</b><span class="muted">${esc(s.country)} · grade ${s.grade}</span></div>
        <span class="badge warn">Cadres : au choix équipementier ou Titre 2</span>
        <ul class="kv"><li>🚲 Équipementier seul : matériel gratuit + ${fmtEUR(Number(s.budget_amount || 0) * 0.25)} / an, sans exigence</li>
          <li>🏷️ Sponsor Titre 2 : ${money(s)}, son nom s'ajoute à celui de l'équipe</li><li>📅 ${s.contract_duration_years} an(s)</li></ul>
        ${s.objectives_description ? `<div class="muted">Exigences (en Titre 2) : ${esc(s.objectives_description)}</div>` : ''}
        ${btn('Signer comme équipementier', 'GEAR_ONLY', lockReason(s, true))}${btn('Signer comme sponsor Titre 2', 'TITLE', titleWhy)}</div>`;
    }
    const why = lockReason(s);
    return `<div class="card offer">
      <div class="head"><b>${esc(s.name)}</b><span class="muted">${esc(s.country)} · grade ${s.grade}</span></div>
      <span class="badge ${s.is_team_sponsor && s.gear_slot ? 'warn' : ''}">${esc(kind(s))}</span>
      <ul class="kv"><li>💶 ${money(s)}</li><li>📅 ${s.contract_duration_years} an(s)</li></ul>
      ${s.objectives_description ? `<div class="muted">Exigences : ${esc(s.objectives_description)}</div>` : ''}
      ${s.is_team_sponsor && s.gear_slot ? '<div class="muted">Exige le slot Titre 2 : son nom s\'ajoute à celui de l\'équipe.</div>' : ''}
      ${btn('Signer', 'TITLE', why)}</div>`;
  };

  const sections = [
    ['Sponsors titres', offers.filter((s) => s.is_team_sponsor && !s.gear_slot)],
    ['Double rôle : Titre 2 + équipement exclusif', offers.filter((s) => s.is_team_sponsor && s.gear_slot && s.gear_slot !== 'FRAME')],
    ...Object.keys(GEAR_LABELS).map((k) => [`Équipementier : ${GEAR_LABELS[k]}`,
      offers.filter((s) => s.gear_slot === k && (!s.is_team_sponsor || k === 'FRAME'))]),
  ];

  c.innerHTML = `
    <h2>Contrats & Sponsors</h2>
    <div class="card"><div class="muted">Nom officiel de l'équipe</div><h3>${esc(t.official_name || t.name)}</h3>
      <div class="muted">Revenus sponsors : ${fmtEUR(monthly)} / mois · Budget : ${fmtEUR(t.budget)}${conti ? ' · Les sponsors de grade 1 ne négocient pas avec une équipe Conti-Pro' : ''}</div>
      <div class="err" id="sp-msg"></div></div>
    <div class="card"><h3>Projection du budget sur 12 mois</h3>
      <div class="${firstNeg >= 0 ? 'err' : 'okmsg'}">${firstNeg >= 0 ? `⚠️ Déficit prévu dès ${p.labels[firstNeg]} : signez des sponsors ou réduisez les dépenses.` : '✅ Trésorerie positive sur 12 mois.'}</div>
      <div class="muted">Revenus ${fmtEUR(p.income)}/mois · Salaires ${fmtEUR(p.payroll)}/mois · Maintenance ${fmtEUR(p.maint)}/mois · Courses ${fmtEUR(RACE_COST)} chacune. Primes non chiffrées dans le catalogue (0 pour l'instant).</div>
      ${typeof Chart === 'undefined' ? '<p class="err">Chart.js non chargé.</p>' : '<canvas id="proj" height="110"></canvas>'}</div>
    <h3>Contrats actifs</h3>
    ${ctx.mine.length ? `<div class="grid2">${ctx.mine.map(contractCard).join('')}</div>` : '<div class="card muted">Aucun contrat : signez vos premiers sponsors pour financer la saison.</div>'}
    ${sections.map(([title, list]) => (list.length ? `<h3>${title}</h3><div class="grid2">${list.map(offerCard).join('')}</div>` : '')).join('')}`;

  if (typeof Chart !== 'undefined') {
    sponsorChart = new Chart($('proj'), { type: 'line',
      data: { labels: p.labels, datasets: [{ data: p.data, borderColor: '#10b981', tension: 0.2,
        segment: { borderColor: (g) => (g.p0.parsed.y < 0 || g.p1.parsed.y < 0 ? '#ef4444' : '#10b981') },
        pointBackgroundColor: p.data.map((v) => (v < 0 ? '#ef4444' : '#10b981')) }] },
      options: { plugins: { legend: { display: false } }, scales: {
        y: { ticks: { callback: (v) => v.toLocaleString('fr-FR') + ' €', color: '#94a3b8' }, grid: { color: '#1e293b' } },
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } } } });
  }

  c.onclick = async (e) => {
    const b = e.target.closest('button[data-sign],button[data-end]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.sign) {
        const { error } = await sb.rpc('sign_sponsor', { p_sponsor: b.dataset.sign, p_mode: b.dataset.mode || 'TITLE' });
        if (error) throw error;
      } else {
        const x = ctx.mine.find((m) => m.id === b.dataset.end);
        if (!confirm(`Rompre le contrat avec ${x.sponsors_catalog.name} ? Pénalité : ${fmtEUR(x.monthly_payout * 3)}`)) { b.disabled = false; return; }
        const { error } = await sb.rpc('terminate_sponsor', { p_contract: b.dataset.end });
        if (error) throw error;
      }
      const { data } = await sb.from('teams').select('*').eq('id', state.team.id).single();
      state.team = data; viewGame();
    } catch (err) { b.disabled = false; $('sp-msg').textContent = err.message; }
  };
}
