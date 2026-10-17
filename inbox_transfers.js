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
