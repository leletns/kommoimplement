// Botão "Diagnóstico da tela" — use na tela de NOVO paciente do Amigo, ainda vazia.
// Copia só a estrutura dos campos (rótulo, tipo, placeholder, classes). Não copia valores digitados.
(async () => {
  const visivel = (el) => el.offsetParent !== null;
  const txt = (n) => (n && n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const campos = [...document.querySelectorAll('input, select, textarea, [role="combobox"], [contenteditable="true"]')].filter(visivel).slice(0, 120);
  const linhas = campos.map((el, i) => {
    let rot = '', p = el.parentElement;
    for (let k = 0; k < 4 && p && !rot; k++, p = p.parentElement) {
      const a = [...p.querySelectorAll('label, span, p, div')].filter((n) => !n.contains(el) && !n.querySelector('input,select,textarea') && /[a-zA-ZÀ-ú]{2,}/.test(n.textContent) && n.textContent.length < 60 && (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (a.length) rot = txt(a[a.length - 1]);
    }
    return {
      i, tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', rotulo: rot,
      placeholder: el.placeholder || '', name: el.name || '', id: el.id || '', classe: String(el.className || '').slice(0, 80),
      readonly: !!el.readOnly, disabled: !!el.disabled, preenchido: el.type === 'checkbox' || el.type === 'radio' ? el.checked : !!(el.value && el.value.trim()),
      opcoes: el.tagName === 'SELECT' ? [...el.options].slice(0, 8).map((o) => txt(o)) : undefined,
      pai: String(el.parentElement && el.parentElement.className || '').slice(0, 60),
    };
  });
  const out = JSON.stringify({ url: location.host + location.pathname, total: linhas.length, campos: linhas });
  let ok = false; try { await navigator.clipboard.writeText(out); ok = true; } catch (e) { /* mostra para copiar */ }
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:360px;background:#fff;color:#13294a;border:2px solid #c98a2b;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)';
  c.innerHTML = '<b>' + (ok ? '✅ Diagnóstico copiado' : '📋 Copie o texto abaixo') + '</b><div style="font-size:12px;color:#5b6b82;margin:6px 0">' + linhas.length + ' campos lidos. Cole no chat do Claude (Ctrl+V). Não inclui dados de paciente.</div>' + (ok ? '' : '<textarea style="width:100%;height:90px;font-size:11px">' + out.replace(/</g, '&lt;') + '</textarea>') + '<div style="text-align:right;margin-top:8px"><button style="border:0;background:#faf1e2;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
  c.querySelector('button').onclick = () => c.remove();
  document.body.appendChild(c);
  const ta = c.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); }
})();
