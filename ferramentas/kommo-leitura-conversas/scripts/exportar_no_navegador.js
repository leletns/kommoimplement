// Exporta as conversas (texto + links dos áudios) dos leads abaixo, usando a SUA sessão do Kommo.
// Só LÊ. Não altera nada. Não envia nada para fora: o resultado é baixado como arquivo no seu computador.
// Como usar: abra o Kommo logado → F12 → aba Console → cole tudo e aperte Enter.
// (Se o Chrome pedir, digite "allow pasting" / "permitir colar" e cole de novo.)
(async () => {
  const IDS = /*IDS*/[];
  const base = location.origin;
  const hdr = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const saida = { conta: location.host, exportado_em: new Date().toISOString(), leads: {} };
  let erros = 0;
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const msgs = [];
    let url = `${base}/ajax/v3/leads/${id}/events_timeline?limit=100`;
    let paginas = 0;
    try {
      while (url && paginas < 30) {
        const r = await fetch(url, { headers: hdr, credentials: 'include' });
        if (r.status === 401 || r.status === 403) throw new Error('SESSAO');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const items = (j._embedded && j._embedded.items) || [];
        for (const it of items) {
          if (it.type !== 89 && it.type !== 90) continue; // 89 recebida, 90 enviada
          const d = typeof it.data === 'object' && it.data ? it.data : {};
          const m = typeof d.message === 'object' && d.message ? d.message : {};
          const a = typeof d.author === 'object' && d.author ? d.author : {};
          msgs.push({ id: m.id || it.id, t: it.type, ts: it.date_create, por: it.created_by || 0, autor: a.name || '',
            tipo: m.type || 'text', texto: m.text || '', media: m.media || '', dur: m.media_duration || 0 });
        }
        let prev = j._links && typeof j._links === 'object' ? j._links.prev : null;
        prev = prev && typeof prev === 'object' ? prev.href : prev;
        url = prev && items.length ? new URL(prev, base).href : null;
        paginas++;
        await esperar(400);
      }
      saida.leads[id] = msgs;
    } catch (e) {
      if (e.message === 'SESSAO') { console.error('Sessão do Kommo expirou: recarregue a página, faça login e rode de novo.'); break; }
      erros++; saida.leads[id] = { erro: e.message };
    }
    if ((i + 1) % 10 === 0 || i === IDS.length - 1) console.log(`Conversas: ${i + 1}/${IDS.length}`);
  }
  const blob = new Blob([JSON.stringify(saida)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `conversas-kommo-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`Pronto: ${Object.keys(saida.leads).length} leads exportados (${erros} com erro). O arquivo foi baixado.`);
})();
