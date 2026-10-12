// admin.js — import des coureurs officiels (réservé à l'admin). Utilise sb, state, esc, toast d'app.js
const COUNTRY_CODES = { Allemagne: 'DE', Autriche: 'AT', Belgique: 'BE', Italie: 'IT', 'Pays-Bas': 'NL', Suisse: 'CH', Slovénie: 'SI', Australie: 'AU', Canada: 'CA',
  Danemark: 'DK', France: 'FR', Norvège: 'NO', 'États-Unis': 'US', Irlande: 'IE', 'Nouvelle-Zélande': 'NZ', 'Royaume-Uni': 'GB', Espagne: 'ES', Portugal: 'PT',
  Suède: 'SE', Pologne: 'PL', Luxembourg: 'LU', Colombie: 'CO', Équateur: 'EC', Japon: 'JP', Mexique: 'MX', Érythrée: 'ER', Kazakhstan: 'KZ', Lettonie: 'LV', Estonie: 'EE' };

// Format : Nom;Date de naissance (jj.mm.aaaa);Âge;Pays;Équipe;14 attributs (MTN,MM,HIL,DHI,ATT,TTR,PRL,FLA,COB,SPR,ACC,STA,RES,REC);Potentiel (x/6);Salaire mensuel;Clause
function parseRiders(text) {
  const rows = [], errors = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    if (/^nom\s*;/i.test(line)) return;
    const f = line.split(';').map((x) => x.trim());
    if (f.length < 9) return errors.push(`Ligne ${i + 1} : ${f.length} champs au lieu de 9`);
    const a = f[5].split(',').map(Number);
    if (a.length !== 14 || a.some((x) => !Number.isFinite(x))) return errors.push(`Ligne ${i + 1} : 14 attributs attendus (${f[0]})`);
    const code = COUNTRY_CODES[f[3]];
    if (!code) return errors.push(`Ligne ${i + 1} : pays inconnu « ${f[3]} » (${f[0]})`);
    const [d, m, y] = f[1].split('.'), parts = f[0].split(' '), pm = f[6].match(/([\d.,]+)\s*\/\s*([\d.,]+)/), num = (s) => parseFloat(String(s).replace(',', '.'));
    rows.push({ first: parts[0], last: parts.slice(1).join(' '), birth: `${y}-${m}-${d}`, age: +f[2], code, team: f[4], a,
      pot: pm ? Math.round((num(pm[1]) / num(pm[2])) * 50) / 10 : null, salary: Number(f[7].replace(/\s/g, '')) || 0, clause: Number(f[8].replace(/\s/g, '')) || 0 });
  });
  return { rows, errors };
}

async function importRiders(rows, wipe) {
  const season = state.game.season_year;
  if (wipe) { const { error } = await sb.from('riders').delete().not('id', 'is', null); if (error) throw error; }
  const { data: existing } = await sb.from('teams').select('id, name');
  const teamId = Object.fromEntries((existing || []).map((t) => [t.name, t.id]));
  for (const name of [...new Set(rows.map((r) => r.team))]) {
    if (teamId[name]) continue;
    const cnt = {}; rows.filter((r) => r.team === name).forEach((r) => (cnt[r.code] = (cnt[r.code] || 0) + 1));
    const nat = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0][0], dev = /dev(elopment)? team/i.test(name);
    const { data, error } = await sb.from('teams').insert({ name, nationality: nat, category: dev ? 'DEV' : 'WORLD_TOUR', division: dev ? 'CONTI_PRO' : 'WORLD_TOUR', budget: 50000 }).select().single();
    if (error) throw error;
    teamId[name] = data.id;
  }
  const recs = rows.map((r, i) => { const a = r.a; return { team_id: teamId[r.team], first_name: r.first, last_name: r.last, nationality: r.code, age: r.age, birth_date: r.birth,
    mtn: a[0], mm: a[1], hil: a[2], dhi: a[3], att: a[4], ttr: a[5], prl: a[6], fla: a[7], cob: a[8], spr: a[9], acc: a[10], sta: a[11], res: a[12], rec: a[13],
    flat: a[7], mountain: a[0], hills: Math.round((a[1] + a[2]) / 2), time_trial: a[5], sprint: a[9], cobbles: a[8], stamina: a[11], recovery: a[13],
    potential: r.pot, contract_salary: r.salary, release_clause: r.clause, contract_end_year: season + 1 + (i % 3), fatigue: 0 }; });
  for (let i = 0; i < recs.length; i += 40) { const { error } = await sb.from('riders').insert(recs.slice(i, i + 40)); if (error) throw error; }
  return Object.keys(teamId).length;
}

function renderAdmin(c) {
  if (!state.isAdmin) { c.innerHTML = '<div class="panel">Réservé à l\'administrateur.</div>'; return; }
  c.innerHTML = `<div class="panel"><h4>Import des coureurs officiels</h4>
    <p class="muted">Collez vos lignes : <code>Nom;Date de naissance;Âge;Pays;Équipe;14 attributs;Potentiel;Salaire;Clause</code>. La ligne d'en-tête est ignorée.</p>
    <textarea id="imp" rows="12" placeholder="Maurice Ballerstedt;16.01.2001;25;Allemagne;Alpecin-Premier Tech WT;57,59,65,72,70,66,68,72,68,71,71,67,68,66;3.5/6;500;350000"></textarea>
    <label style="margin-top:.5rem"><input type="checkbox" id="wipe" checked style="width:auto"> Supprimer d'abord tous les coureurs existants (coureurs de test)</label>
    <div class="sq-ctl" style="margin:.6rem 0"><button id="an">Analyser</button><button id="go" disabled>Importer</button></div>
    <pre id="rep" class="muted" style="white-space:pre-wrap"></pre></div>`;
  let parsed = null;
  $('an').onclick = () => {
    parsed = parseRiders($('imp').value);
    const per = {}; parsed.rows.forEach((r) => (per[r.team] = (per[r.team] || 0) + 1));
    $('rep').textContent = `${parsed.rows.length} coureur(s) valides\\n` + Object.entries(per).map(([t, n]) => `  ${t} : ${n}`).join('\\n') + (parsed.errors.length ? `\\n\\nErreurs :\\n${parsed.errors.join('\\n')}` : '');
    $('go').disabled = !parsed.rows.length || parsed.errors.length > 0;
  };
  $('go').onclick = async () => {
    $('go').disabled = true; $('rep').textContent = 'Import en cours…';
    try { const n = await importRiders(parsed.rows, $('wipe').checked); $('rep').textContent = `Terminé : ${parsed.rows.length} coureurs, ${n} équipes.`; toast('Import terminé.'); }
    catch (e) { $('rep').textContent = 'Erreur : ' + (e.message || e); $('go').disabled = false; }
  };
}
