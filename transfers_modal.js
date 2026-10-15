// transfers_modal.js — Modal de négociation à 3 colonnes (agent · négociation · récapitulatif)
// À charger APRÈS recruit.js : cette fonction remplace l'ancienne openNegotiationModal.
// Utilise sb, state, esc, fmtEUR, toast, $, myTeamIds, enrich ; (si présents) flag, moneyFog, negRefresh, neg, NEG_STATUS
const TM_ROLES = ['Leader', 'Équipier de luxe', 'Poisson-pilote', 'Équipier', 'Élevage U23'];
const TM_RANK = { 'Élevage U23': 0, 'Équipier': 1, 'Poisson-pilote': 2, 'Équipier de luxe': 3, Leader: 4 };
const tmIcon = (open) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="${open ? 'M8 11V7a4 4 0 0 1 7-2.6' : 'M8 11V7a4 4 0 0 1 8 0v4'}"/></svg>`;
const tmRep = (level) => (level < 55 ? 1 : level < 62 ? 2 : level < 68 ? 3 : level < 72 ? 4 : 5);   // même échelle que la fiche coureur
const tmEsc = (e) => { if (e.key === 'Escape') tmClose(); };
const tmClose = () => { const m = $('tm-modal'); if (m) m.remove(); document.removeEventListener('keydown', tmEsc); };
const tmSel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const tmSum = (a, k) => (a || []).reduce((s, x) => s + Number(x[k] || 0), 0);

async function openNegotiationModal(riderId) {
  tmClose(); if (typeof negClose === 'function') negClose();
  const ov = document.createElement('div'); ov.className = 'tm-ov'; ov.id = 'tm-modal';
  ov.innerHTML = '<div class="tm-box"><p class="muted" style="padding:1rem">Chargement de la négociation…</p></div>';
  document.body.appendChild(ov); document.addEventListener('keydown', tmEsc);
  const box = ov.firstElementChild, tid = state.team.id, g = state.game, mineIds = myTeamIds();
  const simple = (title, html) => { box.innerHTML = `<div class="tm-simple"><h3>${title}</h3>${html}<div class="tm-actions"><button id="tm-x">Fermer</button></div></div>`; $('tm-x').onclick = tmClose; };

  const { data: raw } = await sb.from('riders').select('*').eq('id', riderId).maybeSingle();
  if (!raw) return simple('Coureur introuvable', '');
  const [tm, sc, ex, myR, st, so, sp] = await Promise.all([
    raw.team_id ? sb.from('teams').select('id, name, official_name').eq('id', raw.team_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('scouting_reports').select('knowledge').eq('team_id', tid).eq('rider_id', riderId).maybeSingle(),
    sb.from('transfer_offers').select('*').eq('from_team_id', tid).eq('rider_id', riderId).in('status', ['PENDING_CLUB', 'CLUB_ACCEPTED', 'NEGOTIATING_CONTRACT', 'CONTRACT_ACCEPTED']).maybeSingle(),
    sb.from('riders').select('*').in('team_id', mineIds),
    sb.from('staff').select('monthly_salary').eq('team_id', tid),
    sb.from('scouts').select('monthly_salary').eq('team_id', tid),
    sb.from('team_sponsors').select('monthly_payout').eq('team_id', tid),
  ]);
  const r = enrich([raw], g.game_date)[0], kn = sc.data?.knowledge ?? 0, club = tm.data ? tm.data.official_name || tm.data.name : null;
  const freeAgent = !raw.team_id || (raw.contract_end_year != null && raw.contract_end_year <= g.season_year);   // libre : 0 € de rachat
  const mine = enrich(myR.data || [], g.game_date), avg = mine.length ? mine.reduce((s, x) => s + x.level, 0) / mine.length : 65, top = mine.length ? Math.max(...mine.map((x) => x.level)) : 70;
  const payroll = tmSum(myR.data, 'contract_salary') + tmSum(st.data, 'monthly_salary') + tmSum(so.data, 'monthly_salary'), income = tmSum(sp.data, 'monthly_payout'), budget = Number(state.team.budget);
  const buyout = r.clause ?? r.value, name = `${r.first_name} ${r.last_name}`, myName = state.team.official_name || state.team.name;

  // Cas bloquants
  if (mineIds.includes(raw.team_id)) return simple('Offre impossible', '<p>Ce coureur fait déjà partie de votre effectif.</p>');
  if (kn < 50) return simple('Offre impossible', '<p>Observez d\'abord ce coureur : il faut au moins 50 % de connaissance pour négocier.</p>');
  if (tmRep(r.level) - (state.team.division === 'WORLD_TOUR' ? 4 : 2) >= 2) return simple('Négociation refusée', '<p>L\'agent refuse de négocier : l\'écart de réputation entre ce coureur et votre équipe est trop grand.</p>');
  if (ex.data) {
    const o = ex.data, label = typeof NEG_STATUS !== 'undefined' ? NEG_STATUS[o.status] || o.status : o.status;
    simple('Offre en cours : ' + esc(name), `<p><b>${esc(label)}</b></p><p class="muted">Indemnité ${fmtEUR(o.offer_amount)} · salaire ${fmtEUR(o.offered_monthly_salary)} / mois · ${esc(o.offered_role || '-')}${o.contract_years ? ' · ' + o.contract_years + ' an(s)' : ''}</p>`);
    const b = document.createElement('button'); b.className = 'danger'; b.textContent = 'Annuler cette offre'; box.querySelector('.tm-actions').prepend(b);
    b.onclick = async () => {
      const { error } = await sb.from('transfer_offers').update({ status: 'CANCELLED' }).eq('id', o.id);
      if (error) return toast(error.message);
      if (typeof neg !== 'undefined') { neg.open.delete(riderId); neg.at = Date.now(); }
      toast('Offre annulée.'); tmClose(); if (typeof negRefresh === 'function') negRefresh();
    };
    return;
  }

  // Attentes de l'agent (rôle, durée, salaire) déduites du profil du coureur et du niveau de votre équipe
  const desiredRole = r.level >= top - 1 ? 'Leader' : r.level >= avg + 3 ? 'Équipier de luxe' : r.spec === 'FLA' ? 'Poisson-pilote' : r.age <= 22 ? 'Élevage U23' : 'Équipier';
  const desiredYears = r.age <= 24 ? 3 : r.age >= 32 ? 1 : 2, expected = Math.max(500, Math.round(((raw.contract_salary || 0) * 1.05) / 100) * 100);
  const canTrainee = r.age <= 23 && !freeAgent && g.game_date >= `${g.season_year}-08-01`;
  let tab = 'buyout'; const lock = { amount: false, salary: false };

  const field = (id, lbl, inner, lk, hint) => `<div class="tm-row"><label>${lbl}</label><div class="tm-field">${lk ? `<button type="button" class="tm-lock" data-lock="${lk}"></button>` : ''}${inner}</div>${hint ? `<div class="tm-hint">${hint}</div>` : ''}</div>`;
  const amountHint = freeAgent ? 'Libre de tout contrat (0 €) : aucune indemnité à verser.' : `Montant de rachat estimé : ${typeof moneyFog === 'function' ? moneyFog(buyout, r.id, 'clause', kn, false) : fmtEUR(buyout)}. Une offre égale ou supérieure ne peut pas être refusée par le club.`;
  box.innerHTML = `
    <div class="tm-top"><div>Vers <b>${esc(myName)}</b> (${esc(name)})</div><div class="tm-top-r">Offre en cours <button class="link" id="tm-x0">Fermer</button></div></div>
    <div class="tm-grid">
      <aside class="tm-col">
        <div class="tm-card tm-who"><div class="tm-av">${esc(r.first_name[0] + r.last_name[0])}</div><div><b>${esc(name)}</b>
          <div class="muted">${r.age} ans · ${typeof flag === 'function' ? flag(r.nationality) : esc(r.nationality)} · ${esc(club || 'Sans contrat')}</div><div class="tm-status" id="tm-status"></div></div></div>
        <div class="tm-card"><h5>Agent</h5><div id="tm-bubbles" class="tm-bubbles"></div></div>
        <div class="tm-card"><h5>Contraintes du club</h5>
          <div class="tm-kv"><span>Budget transferts / rachat disponible</span><b>${fmtEUR(budget)}</b></div>
          <div class="tm-kv"><span>Masse salariale restante</span><b class="${income - payroll < 0 ? 'down' : 'up'}">${fmtEUR(income - payroll)} / mois</b></div>
          <div class="tm-kv"><span>Revenus sponsors / masse salariale</span><b>${fmtEUR(income)} / ${fmtEUR(payroll)}</b></div></div>
      </aside>
      <section class="tm-col">
        <div class="tm-tabs"><button type="button" data-tab="buyout" class="on">Rachat de contrat / Transfert</button>
          <button type="button" data-tab="trainee" ${canTrainee ? '' : 'disabled title="Réservé aux coureurs de 23 ans et moins sous contrat, à partir du 1er août"'}>Offre de stagiaire (dès le 1er août)</button></div>
        <div class="tm-card"><h5>1. Offre au club${club ? ' : ' + esc(club) : ''}</h5>
          ${field('tm-amount', 'Indemnité de rachat (€)', `<input id="tm-amount" type="number" min="0" step="1000" value="${freeAgent ? 0 : ''}" ${freeAgent ? 'disabled' : ''} placeholder="Montant en euros">`, freeAgent ? '' : 'amount', amountHint)}
          ${field('tm-arrival', 'Date d\'arrivée', tmSel('tm-arrival', [['IMMEDIATE', 'Immédiate'], ['NEXT_SEASON', 'Saison suivante (1er janvier)']], 'IMMEDIATE'))}</div>
        <div class="tm-card"><h5>2. Contrat du coureur</h5>
          ${field('tm-salary', 'Salaire mensuel (€ / mois)', `<input id="tm-salary" type="number" min="0" step="100" placeholder="${expected} environ">`, 'salary', '')}
          ${field('tm-years', 'Durée du contrat', tmSel('tm-years', [[1, '1 an'], [2, '2 ans'], [3, '3 ans'], [4, '4 ans']], desiredYears))}
          ${field('tm-role', 'Rôle convenu', tmSel('tm-role', TM_ROLES.map((x) => [x, x]), 'Équipier'))}
          ${field('tm-win', 'Prime de victoire (€)', '<input id="tm-win" type="number" min="0" step="500" value="0">')}
          ${field('tm-pod', 'Prime de podium (€)', '<input id="tm-pod" type="number" min="0" step="250" value="0">')}</div>
      </section>
      <aside class="tm-col">
        <div class="tm-card"><h5>Récapitulatif</h5><div id="tm-recap"></div></div>
        <div class="tm-card"><h5>Intérêt du coureur</h5><div class="tm-meter"><i id="tm-meter"></i></div><div class="tm-hint" id="tm-meter-t"></div></div>
        <div class="tm-btns"><button type="button" id="tm-send">Proposer l'offre</button><button type="button" id="tm-suggest" class="tm-ghost">Suggérer des modifications</button><button type="button" id="tm-quit" class="tm-quit">Quitter les négociations</button></div>
        <div class="tm-err" id="tm-err"></div>
      </aside>
    </div>`;
  $('tm-x0').onclick = $('tm-quit').onclick = tmClose;

  const val = () => ({ trainee: tab === 'trainee', amount: freeAgent || tab === 'trainee' ? 0 : +$('tm-amount').value || 0, arrival: tab === 'trainee' ? 'IMMEDIATE' : $('tm-arrival').value,
    salary: +$('tm-salary').value || 0, years: tab === 'trainee' ? 0 : +$('tm-years').value, role: tab === 'trainee' ? 'Élevage U23' : $('tm-role').value, win: +$('tm-win').value || 0, pod: +$('tm-pod').value || 0 });
  const score = (v) => {
    const sal = expected ? Math.min(1, v.salary / expected) + (v.salary > expected * 1.15 ? 0.1 : 0) : 1, role = Math.max(0, 1 - 0.25 * Math.max(0, TM_RANK[desiredRole] - TM_RANK[v.role]));
    const yr = v.trainee ? 0.8 : Math.max(0, 1 - 0.15 * Math.abs(v.years - desiredYears)), bon = v.win + v.pod > 0 ? 1 : 0.6;
    return { total: Math.min(1, 0.55 * sal + 0.25 * role + 0.12 * yr + 0.08 * bon), sal, role };
  };
  const refresh = () => {
    const v = val(), s = score(v), immediate = v.arrival === 'IMMEDIATE' ? v.amount : 0, deferred = v.arrival === 'NEXT_SEASON' ? v.amount : 0, yrs = v.trainee ? 0 : v.years;
    const months = v.trainee ? Math.max(1, 12 - Number(g.game_date.slice(5, 7)) + 1) : 12 * v.years, contract = v.salary * months;
    document.querySelectorAll('.tm-lock').forEach((b) => { const l = lock[b.dataset.lock]; b.classList.toggle('on', l); b.innerHTML = tmIcon(!l) + (l ? 'Non négociable' : 'Négociable'); });
    $('tm-status').textContent = v.salary <= 0 ? 'Attend votre proposition' : s.total >= 0.85 ? 'Très favorable' : s.total >= 0.65 ? 'Considère une offre' : s.total >= 0.45 ? 'Hésite' : 'Mécontent de l\'offre';
    $('tm-meter').style.width = Math.round(s.total * 100) + '%'; $('tm-meter-t').textContent = Math.round(s.total * 100) + ' % : plus la jauge est haute, plus l\'agent est enclin à accepter.';
    const talk = [`Mon client souhaite un rôle de <b>${desiredRole}</b> et un contrat jusqu'en <b>${g.season_year + desiredYears - 1}</b>, pour environ <b>${fmtEUR(expected)}</b> par mois.`];
    const fb = [];
    if (v.salary > 0 && s.sal < 0.9) fb.push(`Le salaire proposé est en dessous de nos attentes.`); else if (v.salary > 0) fb.push('Le salaire nous convient.');
    if (TM_RANK[v.role] < TM_RANK[desiredRole]) fb.push(`Il attend davantage de responsabilités qu'un rôle de ${v.role}.`);
    if (!v.trainee && v.years < desiredYears) fb.push('Il souhaiterait un contrat plus long.'); else if (!v.trainee && v.years > desiredYears + 1) fb.push('Un engagement aussi long le fait hésiter.');
    if (v.win + v.pod === 0) fb.push('Des primes de victoire et de podium seraient appréciées.');
    if (lock.salary && s.sal < 0.9) fb.push('Vous avez verrouillé le salaire : nous n\'aurons aucune marge de discussion.');
    if (!freeAgent && !v.trainee && v.amount >= buyout) fb.push('Côté club vendeur : l\'indemnité atteint le montant de rachat, il ne peut pas refuser.');
    $('tm-bubbles').innerHTML = `<div class="tm-bubble">${talk[0]}</div>${fb.length ? `<div class="tm-bubble tm-b2">${fb.join(' ')}</div>` : ''}`;
    $('tm-recap').innerHTML = `
      <div class="tm-kv"><span>Indemnité de rachat</span><b>${fmtEUR(v.amount)}</b></div>
      <div class="tm-kv tm-total"><span>Coût total immédiat</span><b>${fmtEUR(immediate)}</b></div>
      <div class="tm-kv"><span>Coût différé (1er janvier)</span><b>${fmtEUR(deferred)}</b></div>
      <div class="tm-kv"><span>Contrat ${v.trainee ? '(jusqu\'au 31 décembre)' : 'sur ' + yrs + ' an(s)'}</span><b>${fmtEUR(contract)}</b></div>
      <div class="tm-kv"><span>Primes (victoire / podium)</span><b>${fmtEUR(v.win)} / ${fmtEUR(v.pod)}</b></div><hr>
      <div class="tm-kv"><span>Impact masse salariale</span><b class="down">+${fmtEUR(v.salary)} / mois</b></div>
      <div class="tm-kv"><span>Masse salariale restante</span><b class="${income - payroll - v.salary < 0 ? 'down' : 'up'}">${fmtEUR(income - payroll)} → ${fmtEUR(income - payroll - v.salary)}</b></div>
      <div class="tm-kv"><span>Budget après paiement</span><b class="${budget - immediate < 0 ? 'down' : ''}">${fmtEUR(budget - immediate)}</b></div>`;
    $('tm-amount') && ($('tm-amount').disabled = freeAgent || v.trainee); $('tm-years').disabled = v.trainee; $('tm-role').disabled = v.trainee; $('tm-arrival').disabled = v.trainee;
    if (v.trainee) $('tm-role').value = 'Élevage U23';
  };
  box.querySelectorAll('input,select').forEach((el) => (el.oninput = refresh));
  box.querySelectorAll('[data-lock]').forEach((b) => (b.onclick = () => { lock[b.dataset.lock] = !lock[b.dataset.lock]; refresh(); }));
  box.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { if (b.disabled) return; tab = b.dataset.tab; box.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); refresh(); }));
  $('tm-suggest').onclick = () => {                      // l'agent propose des ajustements acceptables
    const v = val(); $('tm-salary').value = Math.max(v.salary, expected);
    if (!v.trainee) { $('tm-years').value = desiredYears; if (TM_RANK[v.role] < TM_RANK[desiredRole]) $('tm-role').value = desiredRole; }
    if (v.win + v.pod === 0) { $('tm-win').value = Math.round((expected * 0.5) / 500) * 500; $('tm-pod').value = Math.round((expected * 0.25) / 250) * 250; }
    refresh(); $('tm-bubbles').insertAdjacentHTML('beforeend', '<div class="tm-bubble tm-b2">Voici une proposition qui devrait nous convenir.</div>');
  };
  refresh();

  $('tm-send').onclick = async () => {
    const v = val(), err = (m) => { $('tm-err').textContent = m; }, immediate = v.arrival === 'IMMEDIATE' ? v.amount : 0;
    if (!freeAgent && !v.trainee && v.amount <= 0) return err('Indiquez une indemnité de rachat.');
    if (!(v.salary > 0)) return err('Proposez un salaire mensuel.');
    if (!v.trainee && !(v.years >= 1 && v.years <= 4)) return err('La durée du contrat va de 1 à 4 ans.');
    if (immediate > budget) return err(`Budget insuffisant : l'indemnité immédiate est de ${fmtEUR(immediate)}.`);
    $('tm-send').disabled = true; err('');
    const { data, error } = await sb.from('transfer_offers').insert({ from_team_id: tid, to_team_id: raw.team_id || null, rider_id: riderId, offer_amount: v.amount,
      offered_monthly_salary: v.salary, offered_role: v.role, status: 'PENDING_CLUB', contract_years: v.years, arrival: v.arrival, offer_type: v.trainee ? 'TRAINEE' : 'BUYOUT',
      win_bonus: v.win, podium_bonus: v.pod, amount_negotiable: !lock.amount, salary_negotiable: !lock.salary }).select().single();
    if (error) { $('tm-send').disabled = false; return err(error.message.includes('column') ? error.message + ' (lancez le script 018 dans Supabase)' : error.message); }
    if (typeof neg !== 'undefined') { neg.open.set(riderId, data); neg.at = Date.now(); }
    toast(`Offre envoyée${club ? ' à ' + club : ''} pour ${name}.`); tmClose(); if (typeof negRefresh === 'function') negRefresh();
  };
}
