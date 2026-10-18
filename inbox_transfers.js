async function loadAcceptedOffers() {
  const { data } = await sb.from('transfer_offers').select('*').eq('from_team_id', state.team.id).eq('status', 'CONTRACT_ACCEPTED');
  const ids = (data || []).map((o) => o.rider_id);
  const { data: rs } = ids.length ? await sb.from('riders').select('id, first_name, last_name').in('id', ids) : { data: [] };
  const nm = Object.fromEntries((rs || []).map((r) => [r.id, `${r.first_name} ${r.last_name}`]));
  return (data || []).filter((o) => o.offer_type !== 'TRAINEE').map((o) => ({ ...o, name: nm[o.rider_id] || 'Coureur' }));
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
