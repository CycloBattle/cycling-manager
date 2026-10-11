// sponsors.js — onglet Contrats & Sponsors (utilise sb, state, esc, fmtEUR, NATS, viewGame définis dans app.js)
const SLOT_LABELS = { TITLE: 'Sponsors titres', NUTRITION: 'Nutrition', FRAME: 'Cadres', TRANSMISSION: 'Transmission',
  WHEELS: 'Roues', TEXTILE: 'Tenues', HELMET_SHOES: 'Casques & chaussures' };

// Registre d'objectifs. Pour en créer un : ajoutez une entrée ici, puis utilisez son "type" dans sponsors.objectives (JSON).
// check() renvoie { met, pending, score(0-100), detail }.
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
  YOUNG_RIDERS: {
    label: (o) => `Au moins ${o.min_count} coureurs de moins de ${o.max_age + 1} ans`,
    check: (o, c) => {
      const n = c.riders.filter((r) => r.age <= o.max_age).length;
      const score = Math.min(100, Math.round((n * 100) / o.min_count));
      return { met: n >= o.min_count, pending: false, score, detail: `${n}/${o.min_count}` };
    },
  },
  WINS: {
    label: (o) => `${o.min} victoire(s) cette saison`,
    check: (o, c) => {
      const w = c.results.filter((r) => r.position === 1).length;
      return { met: w >= o.min, pending: w < o.min, score: w >= o.min ? 100 : 0, detail: `${w}/${o.min}` };
    },
  },
  TOP10: {
    label: (o) => `Un Top 10 sur ${o.race}`,
    check: (o, c) => {
      const met = c.results.some((r) => r.race === o.race && r.position <= 10);
      const done = c.simulated.has(o.race);
      return { met, pending: !met && !done, score: met ? 100 : 0, detail: done ? 'course disputée' : 'à venir' };
    },
  },
  PARTICIPATION: {
    label: (o) => `Aligner l'équipe sur ${o.race}`,
    check: (o, c) => {
      const e = c.entries.find((x) => x.race === o.race);
      const done = c.simulated.has(o.race);
      const met = !!e && (e.status === 'VALIDATED' || done);
      return { met, pending: !met && !done, score: met ? 100 : 0, detail: e ? e.status : 'non inscrit' };
    },
  },
};

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
  const [riders, offers, mine, races, entries] = await Promise.all([
    sb.from('riders').select('id, nationality, age').eq('team_id', tid),
    sb.from('sponsors').select('*').order('monthly_payout', { ascending: false }),
    sb.from('team_sponsors').select('*, sponsors(*)').eq('team_id', tid).order('signed_at'),
    sb.from('races').select('name, status'),
    sb.from('race_entries').select('status, races(name)').eq('team_id', tid),
  ]);
  const ids = (riders.data || []).map((r) => r.id);
  const res = ids.length ? await sb.from('race_results').select('position, races(name)').in('rider_id', ids) : { data: [] };
  return {
    riders: riders.data || [], offers: offers.data || [], mine: mine.data || [],
    simulated: new Set((races.data || []).filter((r) => r.status === 'SIMULATED').map((r) => r.name)),
    entries: (entries.data || []).map((e) => ({ race: e.races?.name, status: e.status })),
    results: (res.data || []).map((r) => ({ position: r.position, race: r.races?.name })),
  };
}

async function renderSponsors(c) {
  c.innerHTML = '<p class="muted">Chargement…</p>';
  const ctx = await loadSponsorCtx();
  const t = state.team;
  const maxTitles = t.division === 'WORLD_TOUR' ? 3 : 2;
  const used = ctx.mine.filter((x) => x.slot_type === 'TITLE' || x.occupies_title_slot).length;
  const owned = new Set(ctx.mine.map((x) => x.sponsor_id));
  const monthly = ctx.mine.reduce((s, x) => s + Number(x.monthly_payout || 0), 0);

  const lockReason = (s) => {
    if (owned.has(s.id)) return 'Déjà sous contrat';
    if (t.division === 'CONTI_PRO' && s.tier > 2) return 'Trop prestigieuse : ignore les équipes Conti-Pro';
    if ((s.type === 'TITLE' || s.requires_title_slot) && used >= maxTitles) return `Slots titres complets (${used}/${maxTitles})`;
    if (s.type !== 'TITLE' && ctx.mine.some((x) => x.slot_type === s.type)) return 'Slot déjà occupé';
    if (Number(s.upfront_cost) > Number(t.budget)) return 'Budget insuffisant';
    return null;
  };
  const reqList = (objs) => (objs || []).map((o) => `<li>${esc(OBJECTIVES[o.type]?.label(o) ?? o.type)}</li>`).join('');

  const contractCard = (x) => {
    const s = x.sponsors, ev = evaluateContract(x, ctx);
    const cls = ev.sat >= 70 ? 'ok' : ev.sat >= 40 ? 'warn' : 'bad';
    return `<div class="card contract">
      <div class="head"><b>${esc(s.name)}</b><span class="muted">${SLOT_LABELS[x.slot_type]} · jusqu'en ${x.contract_end_year}</span></div>
      ${x.occupies_title_slot ? '<span class="badge warn">Occupe le slot titre n°2</span>' : ''}
      <div>${fmtEUR(x.monthly_payout)} / mois</div>
      <label>Satisfaction : ${ev.sat}%</label><div class="bar ${cls}"><i style="width:${ev.sat}%"></i></div>
      <ul class="req">${ev.items.map((i) => `<li class="${i.met ? 'ok' : i.pending ? '' : 'ko'}">${i.met ? '✅' : i.pending ? '⏳' : '❌'} ${esc(i.text)} <span class="muted">(${esc(i.detail)})</span></li>`).join('')}</ul>
      <button class="danger" data-end="${x.id}">Rompre (pénalité ${fmtEUR(s.termination_penalty)})</button></div>`;
  };

  const offerCard = (s) => {
    const why = lockReason(s);
    return `<div class="card offer">
      <div class="head"><b>${esc(s.name)}</b><span class="muted">${esc(NATS[s.nationality] || s.nationality)} · tier ${s.tier}</span></div>
      ${s.requires_title_slot ? '<span class="badge warn">Exige le slot Titre n°2 : son nom s\'ajoute à celui de l\'équipe</span>' : ''}
      <ul class="kv"><li>💶 ${fmtEUR(s.monthly_payout)} / mois</li><li>🏆 Prime de résultat : ${fmtEUR(s.result_bonus)}</li><li>📅 ${s.duration_years} an(s)</li>
        ${Number(s.upfront_cost) > 0 ? `<li class="neg">Investissement initial : ${fmtEUR(s.upfront_cost)}</li>` : ''}
        <li class="neg">Rupture : ${fmtEUR(s.termination_penalty)}</li></ul>
      ${(s.objectives || []).length ? `<div class="muted">Exigences :</div><ul class="req">${reqList(s.objectives)}</ul>` : ''}
      <button data-sign="${s.id}" ${why ? 'disabled' : ''}>Signer</button>${why ? `<div class="muted">${esc(why)}</div>` : ''}</div>`;
  };

  const offers = ctx.offers.filter((s) => s.type !== 'TITLE' || s.nationality === t.nationality);
  c.innerHTML = `
    <h2>Contrats & Sponsors</h2>
    <div class="card"><div class="muted">Nom officiel de l'équipe</div><h3>${esc(t.official_name || t.name)}</h3>
      <div class="muted">Sponsors titres : ${used}/${maxTitles} · Revenus sponsors : ${fmtEUR(monthly)} / mois · Budget : ${fmtEUR(t.budget)}</div>
      <div class="err" id="sp-msg"></div></div>
    <h3>Contrats actifs</h3>
    ${ctx.mine.length ? `<div class="grid2">${ctx.mine.map(contractCard).join('')}</div>` : '<div class="card muted">Aucun contrat pour le moment.</div>'}
    ${Object.keys(SLOT_LABELS).map((type) => {
      const list = offers.filter((s) => s.type === type);
      return list.length ? `<h3>${SLOT_LABELS[type]}</h3><div class="grid2">${list.map(offerCard).join('')}</div>` : '';
    }).join('')}`;

  c.onclick = async (e) => {
    const b = e.target.closest('button[data-sign],button[data-end]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.sign) {
        const { error } = await sb.rpc('sign_sponsor', { p_sponsor: b.dataset.sign });
        if (error) throw error;
      } else {
        const x = ctx.mine.find((m) => m.id === b.dataset.end);
        if (!confirm(`Rompre le contrat avec ${x.sponsors.name} ? Pénalité : ${fmtEUR(x.sponsors.termination_penalty)}`)) { b.disabled = false; return; }
        const { error } = await sb.rpc('terminate_sponsor', { p_contract: b.dataset.end });
        if (error) throw error;
      }
      const { data } = await sb.from('teams').select('*').eq('id', state.team.id).single();
      state.team = data; viewGame();
    } catch (err) { b.disabled = false; $('sp-msg').textContent = err.message; }
  };
}
