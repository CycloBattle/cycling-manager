async function loadAcceptedOffers(history = false) {
  const { data } = await sb.from('transfer_offers').select('*').eq('from_team_id', state.team.id)
    .in('status', history ? ['CONTRACT_ACCEPTED', 'OFFICIALIZED'] : ['CONTRACT_ACCEPTED']).order('updated_at', { ascending: false });
  const rows = (data || []).filter((o) => o.offer_type !== 'TRAINEE');
  const rid = rows.map((o) => o.rider_id), tid = [...new Set(rows.map((o) => o.to_team_id).filter(Boolean))];
  const [rs, ts] = await Promise.all([
    rid.length ? sb.from('riders').select('id, first_name, last_name').in('id', rid) : { data: [] },
    tid.length ? sb.from('teams').select('id, name, official_name').in('id', tid) : { data: [] },
  ]);
  const nm = Object.fromEntries((rs.data || []).map((r) => [r.id, `${r.first_name} ${r.last_name}`])), tn = Object.fromEntries((ts.data || []).map((t) => [t.id, t.official_name || t.name]));
  return rows.map((o) => ({ ...o, name: nm[o.rider_id] || 'Coureur', fromName: state.team.official_name || state.team.name, toName: o.to_team_id ? tn[o.to_team_id] || 'Club vendeur' : 'Sans contrat' }));
}
async function officializeTransfer(offerId) {
  const { error } = await sb.rpc('officialize_transfer', { p_offer: offerId });
  if (error) return toast(error.message);
  const { data: t } = await sb.from('teams').select('*').eq('id', state.team.id).single();
  if (t) state.team = t;
  if (typeof neg !== 'undefined') { neg.open.clear(); neg.at = 0; }
  toast('Transfert officialisé : le coureur rejoint votre équipe.');
  viewGame();
}
if (!window.officializeBound) {
  window.officializeBound = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-officialize]');
    if (b && !b.disabled) { b.disabled = true; officializeTransfer(b.dataset.officialize).finally(() => (b.disabled = false)); }
  });
}
async function loadMessageCtx() {
  const t = state.team;
  const [riders, races, entries, sums, mine, offers] = await Promise.all([
    sb.from('riders').select('id, first_name, last_name, fatigue').in('team_id', myTeamIds()),
    sb.from('races').select('*').order('date'),
    sb.from('race_entries').select('race_id, status').eq('team_id', t.id),
    sb.from('race_summaries').select('summary_text, races(name, date)').order('id', { ascending: false }).limit(10),
    sb.from('team_sponsors').select('monthly_payout').eq('team_id', t.id),
    loadAcceptedOffers(true),
  ]);
  return { riders: riders.data || [], races: races.data || [], mine: mine.data || [], sums: sums.data || [], offers,
    entryByRace: Object.fromEntries((entries.data || []).map((e) => [e.race_id, e.status])) };
}

const inboxOfferCard = (o) => `<div class="inbox-card"><h5>Accord conclu</h5>
  <div class="inbox-deal"><div><b>${esc(o.name)}</b><div class="muted">${esc(o.toName)} &rarr; ${esc(o.fromName)}</div></div><div class="inbox-amount">${fmtEUR(o.offer_amount)}</div></div>
  <ul class="kv"><li>Salaire : ${fmtEUR(o.offered_monthly_salary)} / mois</li><li>Durée : ${o.contract_years || 1} an(s)</li><li>Rôle : ${esc(o.offered_role || '-')}</li>
    <li>Arrivée : ${o.arrival === 'NEXT_SEASON' ? 'saison suivante' : 'immédiate'}</li><li>Primes : ${fmtEUR(o.win_bonus || 0)} (victoire) / ${fmtEUR(o.podium_bonus || 0)} (podium)</li></ul>
  ${o.status === 'CONTRACT_ACCEPTED' ? `<button data-officialize="${o.id}">Officialiser le transfert</button>` : '<span class="badge">Transfert officialisé</span>'}</div>`;

const inboxDetail = (m) => `<div class="inbox-head"><div class="inbox-av">${esc(m.from[0])}</div><div><div class="muted">${esc(m.from)} · ${esc(m.cat)}</div><h3>${esc(m.title)}</h3></div>
  <div class="muted">${esc(m.time || m.date)}</div></div><div class="inbox-body"><p style="white-space:pre-line">${esc(m.body)}</p>${m.offer ? inboxOfferCard(m.offer) : ''}</div>`;

async function renderMessagesView(c) {
  c.innerHTML = '<p class="muted pad">Chargement…</p>';
  const msgs = buildMessages(await loadMessageCtx()), key = 'cm_read_' + state.user.id, readSet = () => new Set(store.get(key, []));
  const draw = () => {
    const rd = readSet(), f = state.mfilter, sel = msgs.find((m) => m.id === state.msel) || msgs[0] || null;
    const list = msgs.filter((m) => f === 'all' || (f === 'new' && !rd.has(m.id)) || (f === 'task' && m.task) || (f === 'toread' && m.toRead && !rd.has(m.id)));
    const tab = (k, l) => `<button data-mf="${k}" class="${f === k ? 'on' : ''}">${l}</button>`;
    c.innerHTML = `<div class="inbox-container">
      <aside class="inbox-sidebar"><div class="tabs">${tab('all', 'Tous')}${tab('new', 'Nouv. (' + msgs.filter((m) => !rd.has(m.id)).length + ')')}${tab('task', 'Tâches (' + msgs.filter((m) => m.task).length + ')')}${tab('toread', 'À lire')}</div>
        <div class="inbox-list">${list.map((m) => `<div class="inbox-item ${rd.has(m.id) ? 'read' : ''} ${sel && sel.id === m.id ? 'sel' : ''}" data-msg="${esc(m.id)}"><span class="inbox-dot"></span>
          <div style="min-width:0;flex:1"><div class="inbox-meta"><span>${esc(m.from)}</span><span>${esc(m.time || m.date)}</span></div><div class="t">${esc(m.title)}</div><span class="tag">${esc(m.cat)}</span></div></div>`).join('') || '<p class="muted">Aucun message.</p>'}</div></aside>
      <section class="inbox-content">${sel ? inboxDetail(sel) : '<p class="muted inbox-empty">Aucun message.</p>'}</section></div>`;
    c.querySelectorAll('[data-mf]').forEach((b) => (b.onclick = () => { state.mfilter = b.dataset.mf; draw(); }));
    c.querySelectorAll('[data-msg]').forEach((el) => (el.onclick = () => {
      state.msel = el.dataset.msg; const r = readSet(); r.add(el.dataset.msg); store.set(key, [...r]); draw();
    }));
  };
  draw();
}
