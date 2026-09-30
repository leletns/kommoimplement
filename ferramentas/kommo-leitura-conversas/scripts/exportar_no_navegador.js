// Exporta as conversas (texto + links dos áudios) dos leads abaixo, usando a SUA sessão do Kommo.
// Só LÊ. Não altera nada. Não envia nada para fora: o resultado fica no seu computador.
// Como usar: abra o Kommo logado → F12 → aba Console → cole tudo e aperte Enter.
// (Se o Chrome pedir, digite "allow pasting" e cole de novo.)
(async () => {
  const IDS = /*IDS*/[];
  const base = location.origin;
  const hdr = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const saida = { conta: location.host, exportado_em: new Date().toISOString(), leads: {} };
  window.conversasKommo = saida;

  // Caixinha na tela com o andamento (e o botão de baixar no fim).
  const caixa = document.createElement('div');
  caixa.style.cssText = 'position:fixed;z-index:2147483647;top:20px;right:20px;background:#fff;border:3px solid #1f6feb;' +
    'border-radius:12px;padding:18px 22px;font:16px/1.4 Arial,sans-serif;color:#111;box-shadow:0 8px 30px rgba(0,0,0,.25);min-width:300px';
  caixa.innerHTML = '<b>Exportando conversas…</b><div id="kx-prog">0 de ' + IDS.length + '</div>';
  document.body.appendChild(caixa);
  const prog = caixa.querySelector('#kx-prog');
  console.log('▶️ Exportação iniciada: ' + IDS.length + ' leads. Não feche esta aba.');

  let erros = 0, comMsg = 0, parou = '';
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
        await esperar(350);
      }
      saida.leads[id] = msgs;
      if (msgs.length) comMsg++;
    } catch (e) {
      if (e.message === 'SESSAO') { parou = 'A sessão do Kommo expirou. Recarregue a página (F5), faça login e rode de novo.'; break; }
      erros++; saida.leads[id] = { erro: e.message };
    }
    prog.textContent = `${i + 1} de ${IDS.length} · ${comMsg} com conversa`;
    if ((i + 1) % 10 === 0) console.log(`Conversas: ${i + 1}/${IDS.length}`);
  }

  const nome = `conversas-kommo-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(saida)], { type: 'application/json' });
  const link = URL.createObjectURL(blob);
  caixa.innerHTML = (parou ? `<div style="color:#b00020;margin-bottom:8px"><b>${parou}</b></div>` : '') +
    `<b>Pronto!</b> ${Object.keys(saida.leads).length} leads · ${comMsg} com conversa · ${erros} com erro<br><br>` +
    `<a href="${link}" download="${nome}" style="display:inline-block;background:#1f6feb;color:#fff;padding:12px 18px;border-radius:8px;` +
    `text-decoration:none;font-weight:bold">⬇️ Baixar conversas</a>` +
    `<div style="margin-top:10px;font-size:13px;color:#555">O arquivo vai para a pasta Downloads. Depois envie para o Claude.</div>`;
  console.log(`✅ Pronto: ${Object.keys(saida.leads).length} leads (${comMsg} com conversa, ${erros} com erro). Clique no botão azul "Baixar conversas".`);
})();
