#!/usr/bin/env python3
"""
Leitura de conversas do Kommo com IA → campos no CRM. Genérico: tudo que muda por cliente fica no config JSON.

Comandos:
  python3 kommo_ia.py setup  --config cliente.json            # mostra/cria campos "IA · …" e o grupo
  python3 kommo_ia.py login  --config cliente.json            # abre navegador pra login manual (1x)
  python3 kommo_ia.py run    --config cliente.json --ids 123 456            # simula (não grava)
  python3 kommo_ia.py run    --config cliente.json --etapa negociacao --limit 10 --write
  python3 kommo_ia.py run    --config cliente.json --etapa negociacao --write --skip-done [--completo]

Modo SEM API de IA (o próprio Claude Code lê as conversas; sessão do Kommo só no navegador do usuário):
  1. scripts/exportar_no_navegador.js → o usuário cola no Console do Kommo logado e baixa conversas-kommo-*.json
  2. python3 kommo_ia.py importar --config cliente.json --arquivo conversas-kommo.json [--plano plano.json]
       → transcreve áudios da paciente com Whisper local (faster-whisper, grátis) e gera out/lotes/lote-NN.txt
  3. o Claude Code lê os lotes e escreve out/extracoes.jsonl ({"lead": id, <chave>: valor, ...} por linha)
  4. python3 kommo_ia.py gravar --config cliente.json --extracoes out/extracoes.jsonl [--write]

Modo padrão = econômico (só campos, modelo mini, só áudio do paciente, sem mensagens do robô).
--completo = modelo maior, todos os áudios e uma nota de resumo no lead.
"""
import argparse, csv, datetime as dt, json, re, subprocess, sys, time, urllib.parse
from pathlib import Path

import requests

TZ = dt.timezone(dt.timedelta(hours=-3))
MODELOS = {
    "economico": {"llm": "gpt-5.4-mini", "stt": "gpt-4o-mini-transcribe", "preco": (0.75, 4.50, 0.003)},
    "completo": {"llm": "gpt-5.4", "stt": "gpt-4o-transcribe", "preco": (2.50, 15.00, 0.006)},
}
NOTE_MARK = "[IA Comercial]"
ROTULOS = {"quem_escreve": "Quem escreve", "tempo_de_dor": "Tempo da queixa", "tratamentos_anteriores": "Tratamentos anteriores",
           "objecao_principal": "Objeção", "quem_decide": "Quem decide", "horario_oferecido": "Horário oferecido",
           "sinal_de_alerta": "⚠️ Sinal de alerta", "proximo_passo": "Próximo passo"}
CAMPOS_NOTA = {  # só vão para a nota (modo completo), não viram campo
    "quem_escreve": "Relação de quem escreve com o paciente, respeitando o gênero do paciente",
    "tempo_de_dor": "Há quanto tempo tem a queixa, se dito",
    "tratamentos_anteriores": "O que já tentou antes",
    "objecao_principal": "Por que não agendou/fechou, nas palavras do paciente",
    "quem_decide": "Quem decide junto",
    "horario_oferecido": "A equipe ofereceu dia e horário concretos (true/false)",
    "sinal_de_alerta": "SÓ sinais que pedem avaliação rápida (perda de força, alteração urinária, febre com dor, "
                       "queda recente com perda de movimento, articulação travada). Limitação do dia a dia NÃO conta: null",
    "proximo_passo": "Sugestão curta e concreta para a atendente retomar",
}


# ---------------- config ----------------
def load_config(path):
    cfg = json.loads(Path(path).read_text())
    cfg["_dir"] = Path(cfg.get("pasta_dados") or Path(path).resolve().parent / f"dados-{cfg['subdominio']}").expanduser()
    for d in ("cache/audio", "cache/transcripts", "cache/timelines", "out"):
        (cfg["_dir"] / d).mkdir(parents=True, exist_ok=True)
    cfg["_web"] = f"https://{cfg['subdominio']}.kommo.com"
    return cfg


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, check=True).stdout.strip()


def secrets(cfg):
    env = sh(cfg["segredos"]["env_cmd"]) if cfg["segredos"].get("env_cmd") else ""
    get = lambda k: next((l.split("=", 1)[1].strip().strip('"') for l in env.splitlines() if l.startswith(k + "=")), "")
    return {"kommo": sh(cfg["segredos"]["kommo_token_cmd"]), "openai": get("OPENAI_API_KEY")}


# ---------------- Kommo (API oficial) ----------------
class Kommo:
    def __init__(self, cfg, token):
        self.api = cfg["_web"] + "/api/v4"
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def call(self, method, path, **kw):
        for attempt in range(5):
            r = self.s.request(method, self.api + path, timeout=40, **kw)
            if r.status_code in (429, 502, 503, 504):
                time.sleep(2 + attempt * 2); continue
            if r.status_code == 204 or not r.content:
                return {}
            r.raise_for_status()
            time.sleep(0.2)
            return r.json()
        r.raise_for_status()

    def fields(self):
        out, page = [], 1
        while True:
            d = self.call("GET", f"/leads/custom_fields?limit=250&page={page}")
            L = d.get("_embedded", {}).get("custom_fields", [])
            out += L
            if len(L) < 250:
                return out
            page += 1

    def stage_ids(self, pipeline, status):
        ids, page = [], 1
        while True:
            d = self.call("GET", f"/leads?filter[statuses][0][pipeline_id]={pipeline}"
                                 f"&filter[statuses][0][status_id]={status}&limit=250&page={page}")
            L = d.get("_embedded", {}).get("leads", [])
            ids += [l["id"] for l in L]
            if len(L) < 250:
                return ids
            page += 1


def resolve_fields(cfg, kommo):
    """Liga cada campo do config ao ID/opções reais do Kommo, pelo nome."""
    by_name = {f["name"]: f for f in kommo.fields()}
    faltando = []
    for c in cfg["campos"]:
        f = by_name.get(c["nome_kommo"])
        if not f:
            faltando.append(c["nome_kommo"]); continue
        c["_id"] = f["id"]
        c["_enums"] = {e["value"]: e["id"] for e in (f.get("enums") or [])}
    return faltando


# ---------------- setup ----------------
KOMMO_TIPO = {"lista": "select", "lista_multipla": "multiselect", "texto": "textarea", "numero": "numeric", "sim_nao": "select"}


def cmd_setup(cfg, criar):
    s = secrets(cfg)
    kommo = Kommo(cfg, s["kommo"])
    faltando = resolve_fields(cfg, kommo)
    print(f"Campos no config: {len(cfg['campos'])} · já existem no Kommo: {len(cfg['campos']) - len(faltando)}")
    novos = [c for c in cfg["campos"] if c["nome_kommo"] in faltando]
    for c in novos:
        print(f"  FALTA criar: {c['nome_kommo']} ({c['tipo']}) {c.get('opcoes', '')}")
    if not novos:
        return
    if not criar:
        print("\nNada criado. Rode de novo com --criar depois de conferir a lista.")
        return
    body = []
    for c in novos:
        item = {"name": c["nome_kommo"], "type": KOMMO_TIPO[c["tipo"]]}
        opcoes = ["Sim", "Não"] if c["tipo"] == "sim_nao" else c.get("opcoes")
        if opcoes:
            item["enums"] = [{"value": v, "sort": i} for i, v in enumerate(opcoes)]
        body.append(item)
    kommo.call("POST", "/leads/custom_fields", json=body)
    resolve_fields(cfg, kommo)
    grupo = cfg.get("grupo_campos")
    if grupo:
        ids = [c["_id"] for c in cfg["campos"] if c.get("_id") and c["nome_kommo"].startswith(cfg.get("prefixo", "IA · "))]
        kommo.call("POST", "/leads/custom_fields/groups", json=[{"name": grupo, "sort": 10, "fields": ids}])
    print(f"Criados {len(novos)} campos" + (f" no grupo '{grupo}'." if grupo else "."))


# ---------------- login e conversa (API privada, sessão do navegador) ----------------
def profile_dir(cfg):
    return cfg["_dir"] / ".pw-profile"


def cmd_login(cfg):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(profile_dir(cfg)), headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(cfg["_web"] + "/leads/")
        print("Faça login no Kommo na janela que abriu. Aguardando até 15 min…")
        ok = False
        for _ in range(180):
            time.sleep(5)
            try:
                r = page.request.get(cfg["_web"] + "/ajax/v4/features?features%5B%5D=ai_copilot_analytics_available",
                                     headers={"X-Requested-With": "XMLHttpRequest"})
                if r.status == 200:
                    ok = True; break
            except Exception:
                pass
        time.sleep(3)
        print("Sessão salva." if ok else "Login não confirmado.")
        ctx.close()


def fetch_timeline(cfg, page, lid):
    items, url, pages = [], f"{cfg['_web']}/ajax/v3/leads/{lid}/events_timeline?limit=100", 0
    hdr = {"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"}
    while url and pages < 30:
        r = page.request.get(url, headers=hdr)
        if r.status in (401, 403):
            raise RuntimeError("SESSAO: sessão do Kommo expirou. Rode o comando login.")
        if r.status != 200:
            raise RuntimeError(f"timeline {lid}: HTTP {r.status}")
        j = r.json()
        batch = (j.get("_embedded") or {}).get("items") or []
        items += batch
        prev = (j.get("_links") or {}).get("prev") if isinstance(j.get("_links"), dict) else None
        prev = prev.get("href") if isinstance(prev, dict) else (prev if isinstance(prev, str) else None)
        url = urllib.parse.urljoin(cfg["_web"], prev) if (prev and batch) else None
        pages += 1
        time.sleep(0.5)
    return items


def parse_messages(cfg, items):
    users = {int(k): v for k, v in cfg.get("usuarios", {}).items()}
    msgs, seen = [], set()
    for it in items:
        if it.get("type") not in (89, 90):  # 89 recebida, 90 enviada
            continue
        data = it.get("data") if isinstance(it.get("data"), dict) else {}
        m = data.get("message") if isinstance(data.get("message"), dict) else {}
        author = data.get("author") if isinstance(data.get("author"), dict) else {}
        mid = m.get("id") or it.get("id")
        if mid in seen:
            continue
        seen.add(mid)
        if it["type"] == 89:
            who = "PACIENTE"
        elif it.get("created_by"):
            who = f"EQUIPE ({users.get(it['created_by']) or author.get('name') or 'atendente'})"
        else:
            who = "BOT/AUTOMAÇÃO"
        msgs.append({"ts": it.get("date_create") or 0, "who": who, "type": m.get("type", "text"),
                     "text": (m.get("text") or "").strip(), "media": m.get("media") or "",
                     "duration": m.get("media_duration") or 0, "mid": mid})
    return msgs


def transcribe(cfg, msg, token, oa, page, model):
    key = re.sub(r"[^\w-]", "_", str(msg["mid"]))
    tfile = cfg["_dir"] / "cache/transcripts" / f"{key}.txt"
    if tfile.exists():
        return tfile.read_text()
    ext = Path(urllib.parse.urlparse(msg["media"]).path).suffix or ".ogg"
    afile = cfg["_dir"] / "cache/audio" / f"{key}{ext}"
    if not afile.exists():
        data = None
        for attempt in range(5):
            r = requests.get(msg["media"], headers={"Authorization": f"Bearer {token}"}, timeout=60)
            if r.status_code == 200 and r.content:
                data = r.content; break
            time.sleep(2 + attempt)
        if data is None:
            r = page.request.get(msg["media"])
            data = r.body() if r.status == 200 else None
        if data is None:
            return "[áudio não pôde ser baixado]"
        afile.write_bytes(data)
    with afile.open("rb") as f:
        text = oa.audio.transcriptions.create(model=model, file=f, language="pt",
                                              prompt=cfg.get("termos_transcricao", "")).text.strip()
    tfile.write_text(text)
    return text


def render(msgs, econ):
    lines = []
    for m in sorted(msgs, key=lambda x: x["ts"]):
        if econ and m["who"] == "BOT/AUTOMAÇÃO":
            continue
        body = m["text"]
        if econ and m["who"].startswith("EQUIPE") and len(body) > 220:
            body = body[:220] + "…"
        if m["type"] in ("voice", "audio"):
            body = f"[ÁUDIO {m['duration']}s] {m.get('transcript', '[não transcrito]')}"
        elif m["type"] not in ("text", "") and not body:
            body = f"[{m['type']}]"
        if body:
            when = dt.datetime.fromtimestamp(m["ts"], TZ).strftime("%d/%m/%Y %H:%M")
            lines.append(f"[{when}] {m['who']}: {body}")
    return "\n".join(lines)


# ---------------- extração ----------------
def build_schema(cfg, completo):
    props = {}
    for c in cfg["campos"]:
        desc = c.get("instrucao", "")
        t = c["tipo"]
        if t == "lista":
            props[c["chave"]] = {"type": "string", "enum": c["opcoes"], "description": desc}
        elif t == "lista_multipla":
            props[c["chave"]] = {"type": "array", "items": {"type": "string", "enum": c["opcoes"]},
                                 "description": desc + ". Lista vazia se não se aplica"}
        elif t == "numero":
            props[c["chave"]] = {"type": ["integer", "null"], "description": desc}
        elif t == "sim_nao":
            props[c["chave"]] = {"type": "boolean", "description": desc}
        else:
            props[c["chave"]] = {"type": ["string", "null"], "description": desc + ". null se não foi dito"}
    if completo:
        for k, d in CAMPOS_NOTA.items():
            props[k] = {"type": "boolean" if k == "horario_oferecido" else ["string", "null"], "description": d}
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def system_prompt(cfg):
    regras = "\n".join(f"- {r}" for r in cfg.get("regras_extra", []))
    return f"""Você lê conversas de WhatsApp entre pacientes e a equipe comercial de {cfg['contexto']} e extrai dados para o CRM.
Regras:
- Nunca invente. Se não aparece na conversa, use null, lista vazia ou "Não informado".
- Os dados são sempre do PACIENTE (quem vai consultar), não de quem escreve.
- Idade: só se dita ou se houver data de nascimento do paciente (a data de hoje está no início). Não estime.
- Mensagens BOT/AUTOMAÇÃO e respostas automáticas do WhatsApp Business do próprio paciente não são fala do paciente.
- A conversa pode ter vários leads antigos do mesmo contato; considere tudo.
- Cidade: só onde o PACIENTE mora, dita por ele. O endereço da clínica ({cfg.get('endereco_clinica', 'da clínica')}) citado pela equipe NÃO é a cidade do paciente.
{regras}
Responda só com o JSON no formato pedido."""


def extract(cfg, oa, transcript, lid, model, completo):
    today = dt.datetime.now(TZ).strftime("%d/%m/%Y")
    resp = oa.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt(cfg)},
                  {"role": "user", "content": f"Hoje: {today}. Lead {lid}.\n\n<conversa>\n{transcript}\n</conversa>"}],
        response_format={"type": "json_schema", "json_schema": {"name": "lead", "strict": True,
                                                                "schema": build_schema(cfg, completo)}},
    )
    return json.loads(resp.choices[0].message.content), resp.usage


def build_patch(cfg, lead, x):
    cur = {c["field_id"] for c in (lead.get("custom_fields_values") or [])}
    out = []
    for c in cfg["campos"]:
        v, fid = x.get(c["chave"]), c.get("_id")
        if fid is None or fid in cur or v in (None, "", []):
            continue
        t = c["tipo"]
        if t == "sim_nao":
            v = "Sim" if v else "Não"
        if t in ("lista", "sim_nao"):
            if v in c["_enums"]:
                out.append({"field_id": fid, "values": [{"enum_id": c["_enums"][v]}]})
        elif t == "lista_multipla":
            ids = [c["_enums"][i] for i in v if i in c["_enums"]]
            if ids:
                out.append({"field_id": fid, "values": [{"enum_id": i} for i in ids]})
        elif t == "numero":
            if isinstance(v, int) and v >= 0:
                out.append({"field_id": fid, "values": [{"value": v}]})
        else:
            out.append({"field_id": fid, "values": [{"value": str(v)}]})
    return out


def note_text(cfg, x):
    rows = [NOTE_MARK]
    for c in cfg["campos"]:
        v = x.get(c["chave"])
        if isinstance(v, list):
            v = ", ".join(v)
        if isinstance(v, bool):
            v = "sim" if v else "não"
        rows.append(f"{c['nome_kommo'].replace(cfg.get('prefixo', 'IA · '), '')}: {v if v not in (None, '') else '—'}")
    for k in CAMPOS_NOTA:
        v = x.get(k)
        if isinstance(v, bool):
            v = "sim" if v else "não"
        if v not in (None, ""):
            rows.append(f"{ROTULOS.get(k, k)}: {v}")
    rows.append(f"(lido por IA em {dt.datetime.now(TZ):%d/%m/%Y} — conferir antes de usar)")
    return "\n".join(rows)


# ---------------- orquestração ----------------
def process(cfg, lid, kommo, page, oa, token, write, skip_done, completo):
    modo = MODELOS["completo" if completo else "economico"]
    lead = kommo.call("GET", f"/leads/{lid}?with=contacts")
    marca = next((c["_id"] for c in cfg["campos"] if c.get("marca_processado") and c.get("_id")), None)
    if skip_done and marca and marca in {c["field_id"] for c in (lead.get("custom_fields_values") or [])}:
        return {"lead": lid, "status": "já processado"}
    lead_ids = [lid]
    contacts = lead.get("_embedded", {}).get("contacts", [])
    if contacts:
        c = kommo.call("GET", f"/contacts/{contacts[0]['id']}?with=leads")
        lead_ids += [x["id"] for x in c.get("_embedded", {}).get("leads", []) if x["id"] != lid][:6]
    msgs = []
    for x in lead_ids:
        msgs += parse_messages(cfg, fetch_timeline(cfg, page, x))
    if not msgs:
        return {"lead": lid, "status": "sem mensagens"}
    audios = [m for m in msgs if m["type"] in ("voice", "audio") and m["media"]]
    if not completo:
        audios = [m for m in audios if m["who"] == "PACIENTE"]
    for m in audios:
        m["transcript"] = transcribe(cfg, m, token, oa, page, modo["stt"])
    transcript = render(msgs, not completo)
    (cfg["_dir"] / "cache/timelines" / f"{lid}.txt").write_text(transcript)
    x, usage = extract(cfg, oa, transcript, lid, modo["llm"], completo)
    patch = build_patch(cfg, lead, x)
    if write:
        if patch:
            kommo.call("PATCH", f"/leads/{lid}", json={"custom_fields_values": patch})
        if completo:
            kommo.call("POST", "/leads/notes", json=[{"entity_id": lid, "note_type": "common",
                                                       "params": {"text": note_text(cfg, x)}}])
    users = {int(k): v for k, v in cfg.get("usuarios", {}).items()}
    return {"lead": lid, "status": "gravado" if write else "simulado", "resp": users.get(lead.get("responsible_user_id"), ""),
            "mensagens": len(msgs), "audios": len(audios), "audio_seg": sum(m["duration"] for m in audios),
            "campos_gravados": len(patch), "tokens_in": usage.prompt_tokens, "tokens_out": usage.completion_tokens, **x}


def cmd_run(cfg, a):
    from playwright.sync_api import sync_playwright
    s = secrets(cfg)
    kommo = Kommo(cfg, s["kommo"])
    faltando = resolve_fields(cfg, kommo)
    if faltando:
        sys.exit(f"Campos não existem no Kommo: {faltando}. Rode: setup --criar")
    import openai
    oa = openai.OpenAI(api_key=s["openai"])
    if a.ids:
        ids = a.ids
    elif a.etapa:
        ids = kommo.stage_ids(cfg["pipeline_id"], cfg["etapas"][a.etapa])
    else:
        sys.exit("Use --ids ou --etapa.")
    ids = ids[: a.limit] if a.limit else ids
    modo = "completo" if a.completo else "economico"
    stamp = dt.datetime.now(TZ).strftime("%Y%m%d-%H%M")
    base = cfg["_dir"] / "out" / f"{a.etapa or 'ids'}-{stamp}"
    print(f"{cfg['cliente']} · {len(ids)} leads · modo {modo} · gravar: {'SIM' if a.write else 'não (simulação)'}")
    rows = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(profile_dir(cfg)), headless=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        for i, lid in enumerate(ids, 1):
            t0 = time.time()
            try:
                row = process(cfg, lid, kommo, page, oa, s["kommo"], a.write, a.skip_done, a.completo)
            except Exception as e:
                msg = str(e)
                if msg.startswith("SESSAO") or "credit" in msg or "insufficient_quota" in msg:
                    print(f"Parado: {msg[:160]}"); break
                row = {"lead": lid, "status": f"erro: {type(e).__name__}: {msg[:200]}"}
            row["segundos"] = round(time.time() - t0, 1)
            rows.append(row)
            with open(f"{base}.jsonl", "a") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(f"[{i}/{len(ids)}] {lid} · {row['status']} · {row['segundos']}s")
        ctx.close()
    cols = ["lead", "status", "resp"] + [c["chave"] for c in cfg["campos"]] + \
           (list(CAMPOS_NOTA) if a.completo else []) + ["mensagens", "audios", "audio_seg", "tokens_in", "tokens_out", "segundos"]
    with open(f"{base}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({**{k: (", ".join(v) if isinstance(v, list) else v) for k, v in r.items()},
                        "lead": f"{cfg['_web']}/leads/detail/{r['lead']}"})
    ok = [r for r in rows if r["status"] in ("gravado", "simulado")]
    pin, pout, pmin = MODELOS[modo]["preco"]
    tin, tout = sum(r["tokens_in"] for r in ok), sum(r["tokens_out"] for r in ok)
    amin = sum(r["audio_seg"] for r in ok) / 60
    custo = tin * pin / 1e6 + tout * pout / 1e6 + amin * pmin
    print(f"\nOK {len(ok)}/{len(rows)} · áudio {amin:.1f} min · tokens {tin}/{tout} · custo estimado US${custo:.2f}")
    print(f"Planilha: {base}.csv")


# ---------------- modo sem API de IA (Claude Code lê) ----------------
_WHISPER = None


def transcrever_local(cfg, mid, media, token, duracao):
    """Baixa o áudio com o token oficial e transcreve com faster-whisper local (grátis)."""
    global _WHISPER
    key = re.sub(r"[^\w-]", "_", str(mid))
    tfile = cfg["_dir"] / "cache/transcripts" / f"{key}.txt"
    if tfile.exists():
        return tfile.read_text()
    ext = Path(urllib.parse.urlparse(media).path).suffix or ".ogg"
    afile = cfg["_dir"] / "cache/audio" / f"{key}{ext}"
    if not afile.exists():
        for attempt in range(5):
            r = requests.get(media, headers={"Authorization": f"Bearer {token}"}, timeout=60)
            if r.status_code == 200 and r.content:
                afile.write_bytes(r.content); break
            time.sleep(2 + attempt)
        else:
            return "[áudio não pôde ser baixado]"
    try:
        if _WHISPER is None:
            from faster_whisper import WhisperModel
            _WHISPER = WhisperModel(cfg.get("whisper_modelo", "small"), device="cpu", compute_type="int8")
        segs, _ = _WHISPER.transcribe(str(afile), language="pt", initial_prompt=cfg.get("termos_transcricao", ""), vad_filter=True)
        text = " ".join(s.text.strip() for s in segs).strip() or "[áudio sem fala]"
    except Exception as e:  # sem whisper instalado ou áudio corrompido: segue sem transcrição
        return f"[áudio {duracao}s não transcrito: {type(e).__name__}]"
    tfile.write_text(text)
    return text


def msgs_do_export(cfg, registros):
    users = {int(k): v for k, v in cfg.get("usuarios", {}).items()}
    out = []
    for r in registros if isinstance(registros, list) else []:
        if r.get("t") == 89:
            who = "PACIENTE"
        elif r.get("por"):
            who = f"EQUIPE ({users.get(r['por']) or r.get('autor') or 'atendente'})"
        else:
            who = "BOT/AUTOMAÇÃO"
        out.append({"ts": r.get("ts") or 0, "who": who, "type": r.get("tipo") or "text", "text": (r.get("texto") or "").strip(),
                    "media": r.get("media") or "", "duration": r.get("dur") or 0, "mid": r.get("id") or f"{r.get('ts')}-{r.get('t')}"})
    return out


def cmd_importar(cfg, a):
    s = secrets(cfg)
    dados = json.loads(Path(a.arquivo).read_text())["leads"]
    plano = json.loads(Path(a.plano).read_text()) if a.plano else [{"lead": int(k), "outros": []} for k in dados]
    lotes_dir = cfg["_dir"] / "out" / "lotes"
    lotes_dir.mkdir(parents=True, exist_ok=True)
    for f in lotes_dir.glob("lote-*.txt"):
        f.unlink()
    feitos, vazios, audios, lote, n_lote = 0, 0, 0, [], 0
    tam = a.tamanho_lote or 12
    def fecha():
        nonlocal lote, n_lote
        if lote:
            n_lote += 1
            (lotes_dir / f"lote-{n_lote:02d}.txt").write_text("\n\n".join(lote))
            lote = []
    for p in plano:
        lid = p["lead"]
        msgs = []
        for x in [lid, *p.get("outros", [])]:
            msgs += msgs_do_export(cfg, dados.get(str(x)))
        seen, unicos = set(), []
        for m in msgs:
            if m["mid"] in seen:
                continue
            seen.add(m["mid"]); unicos.append(m)
        if not any(m["who"] == "PACIENTE" for m in unicos):
            vazios += 1
            continue
        for m in unicos:
            if m["type"] in ("voice", "audio") and m["media"] and m["who"] == "PACIENTE":
                m["transcript"] = transcrever_local(cfg, m["mid"], m["media"], s["kommo"], m["duration"])
                audios += 1
        texto = render(unicos, True)
        (cfg["_dir"] / "cache/timelines" / f"{lid}.txt").write_text(texto)
        lote.append(f"===== LEAD {lid} =====\n{texto}")
        feitos += 1
        if len(lote) >= tam:
            fecha()
    fecha()
    print(f"{feitos} conversas prontas em {n_lote} lotes ({audios} áudios da paciente) · {vazios} sem mensagem da paciente")
    print(f"Lotes: {lotes_dir}")


def cmd_gravar(cfg, a):
    s = secrets(cfg)
    kommo = Kommo(cfg, s["kommo"])
    faltando = resolve_fields(cfg, kommo)
    if faltando:
        sys.exit(f"Campos não existem no Kommo: {faltando}. Rode: setup --criar")
    linhas = [json.loads(l) for l in Path(a.extracoes).read_text().splitlines() if l.strip()]
    stamp = dt.datetime.now(TZ).strftime("%Y%m%d-%H%M")
    base = cfg["_dir"] / "out" / f"gravar-{stamp}"
    patches, rows = [], []
    for x in linhas:
        lead = kommo.call("GET", f"/leads/{x['lead']}")
        patch = build_patch(cfg, lead, x)
        rows.append({"lead": f"{cfg['_web']}/leads/detail/{x['lead']}", "campos_gravados": len(patch),
                     **{k: (", ".join(v) if isinstance(v, list) else v) for k, v in x.items() if k != "lead"}})
        if patch:
            patches.append({"id": x["lead"], "custom_fields_values": patch})
    if a.write:
        for i in range(0, len(patches), 50):
            kommo.call("PATCH", "/leads", json=patches[i:i + 50])
    cols = ["lead", "campos_gravados"] + [c["chave"] for c in cfg["campos"]]
    with open(f"{base}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)
    print(f"{len(linhas)} leads lidos · {len(patches)} com campos a gravar · {sum(len(p['custom_fields_values']) for p in patches)} campos"
          + (" · GRAVADO no Kommo" if a.write else " · simulação (use --write)"))
    print(f"Planilha: {base}.csv")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["setup", "login", "run", "importar", "gravar"])
    ap.add_argument("--arquivo")
    ap.add_argument("--plano")
    ap.add_argument("--tamanho-lote", type=int)
    ap.add_argument("--extracoes")
    ap.add_argument("--config", required=True)
    ap.add_argument("--criar", action="store_true")
    ap.add_argument("--ids", nargs="*", type=int)
    ap.add_argument("--etapa")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--skip-done", action="store_true")
    ap.add_argument("--completo", action="store_true")
    a = ap.parse_args()
    cfg = load_config(a.config)
    {"setup": lambda: cmd_setup(cfg, a.criar), "login": lambda: cmd_login(cfg), "run": lambda: cmd_run(cfg, a),
     "importar": lambda: cmd_importar(cfg, a), "gravar": lambda: cmd_gravar(cfg, a)}[a.cmd]()
