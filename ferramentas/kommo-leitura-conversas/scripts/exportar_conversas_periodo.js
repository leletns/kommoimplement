// Exporta as conversas de WhatsApp (texto + links dos áudios) de TODOS os leads que tiveram movimento no período,
// junto com etapa, funil, responsável e data de criação de cada lead. Usa a SUA sessão do Kommo.
// Só LÊ. Não altera nada. Não envia nada para fora: o arquivo fica no seu computador.
// Como usar: abra o Kommo logado → F12 → aba Console → cole tudo e aperte Enter.
// (Se o navegador pedir, digite "allow pasting" e cole de novo.)
// Período: troque DESDE abaixo. Padrão: desde quinta 01/10/2026 00:00 (horário de Brasília) até agora.
(async () => {
  const DESDE = '2026-10-01T00:00:00-03:00';
  const ATE = null; // null = agora. Ex.: '2026-10-05T23:59:59-03:00'
  const base = location.origin;
  const hdr = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const de = Math.floor(new Date(DESDE).getTime() / 1000);
  const ate = ATE ? Math.floor(new Date(ATE).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const saida = { conta: location.host, exportado_em: new Date().toISOString(), periodo: { de: DESDE, ate: ATE || new Date().toISOString() }, etapas: {}, usuarios: {}, info: {}, leads: {} };
  window.conversasKommo = saida;

  const caixa = document.createElement('div');
  caixa.style.cssText = 'position:fixed;z-index:2147483647;top:20px;right:20px;background:#fff;border:3px solid #1f6feb;' +
    'border-radius:12px;padding:18px 22px;font:16px/1.4 Arial,sans-serif;color:#111;box-shadow:0 8px 30px rgba(0,0,0,.25);min-width:300px';
  caixa.innerHTML = '<b>Exportando conversas…</b><div id="kx-prog">Procurando os leads do período…</div>';
  document.body.appendChild(caixa);
  const prog = caixa.querySelector('#kx-prog');
  const pegar = async (url) => {
    const r = await fetch(url, { headers: hdr, credentials: 'include' });
    if (r.status === 401 || r.status === 403) throw new Error('SESSAO');
    if (r.status === 204) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };

  try {
    // Nomes das etapas e dos usuários (para o arquivo já vir legível).
    const funis = await pegar(`${base}/api/v4/leads/pipelines`);
    for (const p of (funis && funis._embedded && funis._embedded.pipelines) || []) {
      for (const s of (p._embedded && p._embedded.statuses) || []) saida.etapas[s.id] = { funil: p.name, etapa: s.name };
    }
    const us = await pegar(`${base}/api/v4/users?limit=250`).catch(() => null);
    for (const u of (us && us._embedded && us._embedded.users) || []) saida.usuarios[u.id] = u.name;

    // Leads com movimento no período (atualizados entre DESDE e ATE).
    for (let pag = 1; pag <= 40; pag++) {
      const j = await pegar(`${base}/api/v4/leads?limit=250&page=${pag}&filter[updated_at][from]=${de}&filter[updated_at][to]=${ate}`);
      const itens = (j && j._embedded && j._embedded.leads) || [];
      for (const l of itens) {
        const e = saida.etapas[l.status_id] || {};
        saida.info[l.id] = { nome: l.name, funil: e.funil || l.pipeline_id, etapa: e.etapa || l.status_id, responsavel: saida.usuarios[l.responsible_user_id] || l.responsible_user_id,
          criado_em: new Date(l.created_at * 1000).toISOString(), atualizado_em: new Date(l.updated_at * 1000).toISOString(), valor: l.price || 0,
          tags: ((l._embedded && l._embedded.tags) || []).map((t) => t.name) };
      }
      prog.textContent = `Procurando leads… ${Object.keys(saida.info).length}`;
      if (itens.length < 250) break;
      await esperar(300);
    }
  } catch (e) {
    caixa.innerHTML = '<b style="color:#b00020">' + (e.message === 'SESSAO' ? 'A sessão do Kommo expirou. Recarregue (F5), faça login e rode de novo.' : 'Não consegui listar os leads: ' + e.message) + '</b>';
    return;
  }

  const IDS = Object.keys(saida.info);
  console.log('▶️ ' + IDS.length + ' leads com movimento no período. Não feche esta aba.');
  let erros = 0, comMsg = 0, noPeriodo = 0, parou = '';
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const msgs = [];
    let url = `${base}/ajax/v3/leads/${id}/events_timeline?limit=100`;
    let paginas = 0;
    try {
      while (url && paginas < 30) {
        const j = await pegar(url);
        const items = (j && j._embedded && j._embedded.items) || [];
        for (const it of items) {
          if (it.type !== 89 && it.type !== 90) continue; // 89 recebida, 90 enviada
          const d = typeof it.data === 'object' && it.data ? it.data : {};
          const m = typeof d.message === 'object' && d.message ? d.message : {};
          const a = typeof d.author === 'object' && d.author ? d.author : {};
          msgs.push({ id: m.id || it.id, t: it.type, ts: it.date_create, por: it.created_by || 0, autor: a.name || '',
            tipo: m.type || 'text', texto: m.text || '', media: m.media || '', dur: m.media_duration || 0 });
        }
        let prev = j && j._links && typeof j._links === 'object' ? j._links.prev : null;
        prev = prev && typeof prev === 'object' ? prev.href : prev;
        url = prev && items.length ? new URL(prev, base).href : null;
        paginas++;
        await esperar(350);
      }
      saida.leads[id] = msgs;
      if (msgs.length) comMsg++;
      if (msgs.some((m) => m.ts >= de && m.ts <= ate)) noPeriodo++;
    } catch (e) {
      if (e.message === 'SESSAO') { parou = 'A sessão do Kommo expirou no meio. Recarregue (F5), faça login e rode de novo.'; break; }
      erros++; saida.leads[id] = { erro: e.message };
    }
    prog.textContent = `${i + 1} de ${IDS.length} · ${noPeriodo} conversaram no período`;
    if ((i + 1) % 10 === 0) console.log(`Conversas: ${i + 1}/${IDS.length}`);
  }

  const nome = `conversas-kommo-periodo-${new Date().toISOString().slice(0, 10)}.json`;
  const link = URL.createObjectURL(new Blob([JSON.stringify(saida)], { type: 'application/json' }));
  caixa.innerHTML = (parou ? `<div style="color:#b00020;margin-bottom:8px"><b>${parou}</b></div>` : '') +
    `<b>Pronto!</b> ${IDS.length} leads · ${noPeriodo} conversaram no período · ${erros} com erro<br><br>` +
    `<a href="${link}" download="${nome}" style="display:inline-block;background:#1f6feb;color:#fff;padding:12px 18px;border-radius:8px;` +
    `text-decoration:none;font-weight:bold">⬇️ Baixar conversas</a>` +
    `<div style="margin-top:10px;font-size:13px;color:#555">O arquivo vai para a pasta Downloads. Depois envie para o Claude.</div>`;
  console.log(`✅ Pronto: ${IDS.length} leads (${noPeriodo} conversaram no período, ${erros} com erro). Clique em "Baixar conversas".`);
})();
