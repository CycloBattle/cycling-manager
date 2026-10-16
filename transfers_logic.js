// transfers_logic.js : négociation agent + club
const TL_MULT = { 'Élevage U23': 0.85, 'Équipier': 1, 'Poisson-pilote': 1.08, 'Équipier de luxe': 1.18, Leader: 1.4 };
const TL_RANK = { 'Élevage U23': 0, 'Équipier': 1, 'Poisson-pilote': 2, 'Équipier de luxe': 3, Leader: 4 };
const tlK = (n) => Math.round(n / 1000) * 1000, tlC = (n) => Math.ceil(n / 100) * 100;

function evaluateOffer(rider, offer) {
  const o = { amount: 0, salary: 0, role: 'Équipier', season: 0, teamAvg: 0, teamTop: 999, ...offer }, locks = (o.lockAmount ? 1 : 0) + (o.lockSalary ? 1 : 0);
  
  if (o.trainee) return { score: 90, feedback: "Le stage nous convient : j'accepte de transmettre l'offre au club.", counterOffer: null };

  const free = !rider.team_id || rider.contract_end_year <= o.season;
  const natural = rider.level >= o.teamTop - 1 ? 'Leader' : rider.level >= o.teamAvg + 3 ? 'Équipier de luxe' : 'Équipier';
  const minFor = (rl) => tlC(((rider.contract_salary || 2000) / TL_MULT[natural]) * TL_MULT[rl] * (1 + Math.max(0, rider.pot - rider.level) / 200) * (rider.age <= 22 ? 1.1 : rider.age >= 33 ? 0.95 : 1) * 1.05 * (1 + 0.04 * locks)), minSalary = minFor(o.role);
  const ask = free ? 0 : tlK(Math.min(rider.clause ?? Infinity, rider.value * (0.5 + 0.3 * Math.max(0, rider.contract_end_year - o.season))));
  const sal = Math.min(1, o.salary / minSalary) ** 1.5, role = 1 - 0.25 * Math.max(0, TL_RANK[natural] - TL_RANK[o.role]);
  const club = !ask ? 1 : rider.clause != null && o.amount >= rider.clause ? 1 : Math.min(1, o.amount / ask);
  const score = Math.round(Math.min(sal * (0.7 + 0.3 * role), club) * 100);
  const cRole = TL_RANK[o.role] < TL_RANK[natural] ? natural : o.role, cSalary = o.lockSalary ? o.salary : Math.max(o.salary, minFor(cRole));
  const counterOffer = score >= 50 && score < 85 && cSalary >= minFor(cRole) ? { salary: cSalary, amount: o.lockAmount ? o.amount : Math.max(o.amount, ask), role: cRole } : null;
  const c = counterOffer, feedback = score >= 85 ? "Nous sommes d'accord : j'accepte de transmettre l'offre au club."
    : c ? `Nous y sommes presque. Pour conclure : ${fmtEUR(c.salary)} / mois${ask ? `, ${fmtEUR(c.amount)} d'indemnité` : ''}, rôle de ${c.role}.`
    : score >= 30 ? "Cette offre est trop basse, nous ne pouvons pas l'accepter." : "C'est insultant ! Mon client ne souhaite plus discuter.";
  return { score, feedback, counterOffer };
}

async function submitOfferToAgent(riderId, offerState) {
  const { data: raw } = await sb.from('riders').select('*').eq('id', riderId).single();
  const o = { season: state.game.season_year, ...offerState }, res = evaluateOffer(enrich([raw], state.game.game_date)[0], o);
  const b = $('tm-bubbles');
  if (b) { b.insertAdjacentHTML('beforeend', `<div class="tm-bubble tm-b2${res.score < 50 ? ' tm-angry' : ''}"><small>Agent</small>${esc(res.feedback)}</div>`); b.scrollTop = b.scrollHeight; }
  if (res.counterOffer) Object.entries({ 'tm-salary': res.counterOffer.salary, 'tm-amount': res.counterOffer.amount, 'tm-role': res.counterOffer.role })
    .forEach(([id, v]) => { if ($(id) && !$(id).disabled)$(id).value = v; });
  
  let saved = false;
  if (res.score >= 85) {
    const { data, error } = await sb.from('transfer_offers').insert({
      from_team_id: state.team.id, to_team_id: raw.team_id || null, rider_id: riderId, offer_amount: o.amount,
      offered_monthly_salary: o.salary, offered_role: o.role, status: 'PENDING_CLUB', contract_years: o.trainee ? 0 : o.years || 1, arrival: o.arrival || 'IMMEDIATE',
      offer_type: o.trainee ? 'TRAINEE' : 'BUYOUT', win_bonus: o.win || 0, podium_bonus: o.pod || 0, amount_negotiable: !o.lockAmount, salary_negotiable: !o.lockSalary
    }).select().single();
    if (error) { toast(error.message); return { ...res, saved }; }
    await sb.from('transfer_offers').update({ status: 'CONTRACT_ACCEPTED' }).eq('id', data.id);
    saved = true;
    toast('Accord conclu : contrat accepté.');
  }
  return { ...res, saved };
}
