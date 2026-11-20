"""Interface web da interface experimental (tela do leitor HUMANO) + modo agente ao vivo.

Usa a MESMA máquina de estados (env.py) do agente. Dois modos:
  humano  uma pessoa opera pelos botões; os eventos vão para o mesmo log JSON (origin=human)
  agente  o UX-Agent opera passo a passo; a página mostra a tela, a observação textual o_t
          enviada ao agente, a resposta do LLM e os eventos registrados.

Uso (a partir da pasta uxagent):
  python web_ui.py                 # abre em http://127.0.0.1:8765
  $env:GROQ_API_KEY="..."; python web_ui.py   # habilita o agente Groq
Logs: data\\web_sessions\\<run_id>.jsonl (mesmo esquema v1).
"""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from env import Environment, HELP_TEXT, PAINEL
from persona import Persona, sample_persona
from scenes import SCENES
from verifier import verify

MAX_ACTIONS = 40
MAX_REJECTS = 3
OUT_DIR = Path(__file__).parent / "data" / "web_sessions"
AGENT_DELAY = 1.6  # segundos entre passos do agente (para a demonstração ser legível)


class Session:
    def __init__(self, task: str, seed: int, mode: str, policy_name: str):
        assert task in SCENES, "somente C1 e C2 (calibração)"
        self.task, self.seed, self.mode, self.policy_name = task, seed, mode, policy_name
        # pessoa: persona neutra (sem máscara, janela cheia, sem portão do painel, sem deslize motor);
        # u < 0 faz a ajuda estar sempre disponível, pois uma pessoa pode sempre pedir ajuda
        persona = Persona(seed, 1.0, 4, -1.0, False, 1.0) if mode == "humano" else sample_persona(seed)
        self.env = Environment(SCENES[task], persona)
        self.run_id = f"web_{mode}_{policy_name if mode == 'agente' else 'pessoa'}_{task}_s{seed}"
        self.t0 = time.time()
        self.events: list[dict] = []
        self.lock = threading.Lock()
        self.done = False
        self.result = None
        self.last_agent: dict = {}
        self.rejected = self.consecutive = 0
        self.technical = self.timed_out = self.stalled = False
        self.error = None
        self._log("system", "task_start", {"policy": policy_name if mode == "agente" else "human",
                                           "max_actions": MAX_ACTIONS, "interface": "web"})
        self._log("persona", "parameter_sampled", persona.params())
        if mode == "agente":
            threading.Thread(target=self._agent_loop, daemon=True).start()

    # ------------------------------------------------------------------ log
    def _log(self, origin, type_, data, before=None, after=None):
        self.events.append({"schema": "v1", "run_id": self.run_id, "task": self.task, "seed": self.seed,
                            "seq": len(self.events), "t": round(time.time() - self.t0, 4), "origin": origin,
                            "type": type_, "data": data, "state_before": before, "state_after": after})

    def _finish(self):
        self.result = verify(self.task, self.env.snapshot(), self.env.executed, self.technical,
                             self.timed_out, self.stalled)
        self._log("verifier", "verification", self.result, after=self.env.snapshot())
        self.done = True
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / f"{self.run_id}.jsonl").write_text(
            "\n".join(json.dumps(e, ensure_ascii=False) for e in self.events) + "\n", encoding="utf-8")

    # ------------------------------------------------------------------ passo (humano e agente)
    def _step(self, action: str, origin: str) -> bool:
        ids = [a for a, _ in self.env.allowed()]
        if action not in ids:
            self.rejected += 1
            self.consecutive += 1
            self._log("system", "action_rejected", {"proposal": action, "reason": "not_enabled"},
                      after=self.env.snapshot())
            if self.consecutive >= MAX_REJECTS and origin == "agent":
                self.stalled = True
            return False
        self.consecutive = 0
        if action == "pedir_ajuda":
            self._log(origin, "help_requested", {})
        meta = self.env.apply(action)
        self._log(origin, "action_executed", {"requested": meta["requested"], "executed": meta["executed_action"],
                                              "support": meta["support"]}, meta["state_before"], meta["state_after"])
        if "motor_slip" in meta:
            self._log("persona", "motor_slip", meta["motor_slip"])
        if action.startswith("ajuda_"):
            self._log("system", "help_delivered", {"type": action})
        return True

    def act(self, action: str):
        with self.lock:
            if self.done or self.mode != "humano":
                return
            self._step(action, "human")
            if self.env.executed >= MAX_ACTIONS and not self.env.terminal:
                self.timed_out = True
            if self.env.terminal or self.timed_out:
                self._finish()

    def _agent_loop(self):
        try:
            if self.policy_name == "groq":
                from policies import GroqPolicy
                policy = GroqPolicy(temperature=0.3)
            else:
                from policies import RandomPolicy
                policy = RandomPolicy()
        except Exception as exc:
            with self.lock:
                self.error = repr(exc)
                self.technical = True
                self._log("system", "technical_failure", {"error": repr(exc)})
                self._finish()
            return
        loops = 0
        while True:
            time.sleep(AGENT_DELAY)
            with self.lock:
                if self.done:
                    return
                if self.env.terminal or self.stalled:
                    self._finish()
                    return
                if self.env.executed >= MAX_ACTIONS:
                    self.timed_out = True
                    self._finish()
                    return
                loops += 1
                obs, ids = self.env.observe(), [a for a, _ in self.env.allowed()]
                self._log("system", "observation", {"text": obs, "audit": self.env.observation_audit()})
            try:  # chamada ao LLM fora do lock: a página continua respondendo
                res = policy.propose(obs, ids, self.seed, loops)
            except Exception as exc:
                with self.lock:
                    self.error = repr(exc)
                    self.technical = True
                    self._log("system", "technical_failure", {"error": repr(exc)})
                    self._finish()
                return
            with self.lock:
                if res["request"] is not None:
                    self._log("system", "llm_request", {"messages": res["request"]})
                self._log("agent", "llm_response", {"raw": res["raw"], "proposal": res["action"],
                                                    **({"meta": res["meta"]} if "meta" in res else {})})
                self.last_agent = {"raw": res["raw"], "proposal": res["action"], "step": loops}
                self._step(res["action"], "agent")

    # ------------------------------------------------------------------ visão para a página
    def view(self) -> dict:
        with self.lock:
            env, sc = self.env, self.env.scene
            vis = set(env._visible())
            panels = []
            for i, pn in enumerate(sc["panels"]):
                ver = "en" if (env.page_original or env.version[pn["id"]] == "en") else "pt"
                state = "visible" if i in vis else ("unread" if i > env.focus else "read_hidden")
                panels.append({"id": pn["id"], "caption": pn["caption"], "state": state, "version": ver,
                               "text": (pn["en"] if ver == "en" else pn["pt"]) if state == "visible" else None,
                               "highlighted": pn["highlighted"], "focus": i == env.focus})
            pairs = [{"id": pn["id"], "en": pn["en"], "pt": pn["pt"]} for pn in sc["panels"]] \
                if env.state == PAINEL else None
            return {"run_id": self.run_id, "mode": self.mode, "task": self.task, "seed": self.seed,
                    "instruction": sc["instruction"], "question": sc["question"], "scene": env.state,
                    "panels": panels, "pairs": pairs, "options": sc["options"], "selected": env.selected,
                    "allowed": [{"id": a, "label": lb} for a, lb in env.allowed()],
                    "observation": env.observe(), "agent": self.last_agent,
                    "help": HELP_TEXT.get(env.help_shown) if env.help_shown else None,
                    "executed": env.executed, "done": self.done, "result": self.result, "error": self.error,
                    "events": [{"seq": e["seq"], "origin": e["origin"], "type": e["type"],
                                "data": ({k: v for k, v in e["data"].items() if k not in ("text", "messages")})}
                               for e in self.events if e["type"] not in ("observation", "llm_request")][-14:]}


SESSION: Session | None = None

PAGE = r"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UX-Agent - interface experimental</title>
<style>
:root{--bg:#f6f7f9;--fg:#1c2330;--card:#fff;--line:#d5dae3;--acc:#1d5fd1;--onacc:#fff;--tr:#e3f0ff;--or:#fff1d6;--warn:#b4380b;--mut:#5b6577}
@media (prefers-color-scheme:dark){:root{--bg:#12161d;--fg:#e8ecf3;--card:#1b212b;--line:#323b4a;--acc:#6aa0ff;--onacc:#0b1220;--tr:#18304f;--or:#4a3a14;--warn:#ff9770;--mut:#9aa6ba}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
header h1{font-size:16px;margin:0 12px 0 0}select,input,button{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
button{cursor:pointer}button.pri{background:var(--acc);color:var(--onacc);border-color:var(--acc)}button:disabled{opacity:.45;cursor:not-allowed}
main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;padding:14px}
@media (max-width:900px){main{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.card h2{font-size:13px;margin:0 0 8px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
.panel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0}.panel.focus{outline:2px solid var(--acc)}
.panel.unread{opacity:.5;border-style:dashed}.panel.read_hidden{opacity:.65}
.bal{margin-top:6px;padding:6px 10px;border-radius:14px;display:inline-block}.bal.pt{background:var(--tr)}.bal.en{background:var(--or)}
.tag{font-size:12px;color:var(--mut)}.hl{font-size:12px;color:var(--warn);font-weight:600}
.btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.opt.sel{background:var(--acc);color:var(--onacc);border-color:var(--acc)}
pre{white-space:pre-wrap;word-break:break-word;margin:0;font:12.5px/1.4 ui-monospace,Consolas,monospace}
.ev{font:12px/1.4 ui-monospace,Consolas,monospace;border-bottom:1px solid var(--line);padding:2px 0;white-space:pre-wrap;word-break:break-word}
.res{padding:10px;border-radius:8px;border:1px solid var(--line);margin-top:8px}.ok{border-color:#2d9b57}.bad{border-color:var(--warn)}
</style></head><body>
<header><h1>UX-Agent &middot; interface experimental</h1>
<label>Tarefa <select id="task"><option>C1</option><option>C2</option></select></label>
<label>Semente <input id="seed" type="number" value="1" style="width:72px"></label>
<label>Modo <select id="mode"><option value="humano">Humano</option><option value="agente">Agente (LLM)</option></select></label>
<label id="pl" style="display:none">Agente <select id="pol"><option value="groq">Groq gpt-oss-120b</option><option value="random">Aleatório (neutro)</option></select></label>
<button class="pri" id="go">Iniciar</button></header>
<main><section class="card"><h2>Tela do leitor (o que a pessoa vê)</h2><div id="screen">Escolha tarefa, semente e modo e clique em Iniciar.</div></section>
<section><div class="card"><h2>Observação o_t enviada ao agente</h2><pre id="obs">-</pre></div>
<div class="card" style="margin-top:12px"><h2>Resposta do LLM</h2><pre id="llm">-</pre></div>
<div class="card" style="margin-top:12px"><h2>Eventos registrados (log JSON)</h2><div id="ev"></div><div id="res"></div></div></section></main>
<script>
const $=id=>document.getElementById(id);
async function api(p,b){const r=await fetch(p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json()}
$('mode').onchange=()=>{$('pl').style.display=$('mode').value==='agente'?'':'none'};
$('go').onclick=async()=>{await api('/api/new',{task:$('task').value,seed:+$('seed').value,mode:$('mode').value,policy:$('pol').value});last='';poll()};
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
async function act(a){await api('/api/act',{action:a});poll()}
function render(v){
 const s=$('screen');s.replaceChildren();
 s.append(el('div','tag','Tarefa '+v.task+' · semente '+v.seed+' · cena: '+v.scene+' · ações executadas: '+v.executed));
 if(v.error){s.append(el('div','res bad','Erro: '+v.error+(v.error.includes('GROQ_API_KEY')?' — defina GROQ_API_KEY antes de iniciar o servidor ou escolha o agente Aleatório.':'')))}
 else if(v.done&&v.result){s.append(el('div','res '+(v.result.correct?'ok':'bad'),'Execução encerrada: '+v.result.status+' ('+v.result.executed_actions+' ações). A verificação externa está no painel ao lado.'))}
 s.append(el('p','',v.instruction));const qn=el('p','','Pergunta: '+v.question);qn.style.fontWeight='600';s.append(qn);
 v.panels.forEach(p=>{const d=el('div','panel '+p.state+(p.focus?' focus':''));
  d.append(el('div','tag','Quadro '+p.id+' · '+p.caption));
  if(p.state==='visible'){d.append(el('div','bal '+p.version,'"'+p.text+'" ('+(p.version==='pt'?'tradução':'original')+')'));if(p.highlighted)d.append(el('div','hl','fala destacada'))}
  else d.append(el('div','tag',p.state==='unread'?'ainda não lido':'já lido, fora da janela de leitura'));
  s.append(d)});
 if(v.pairs){const d=el('div','panel');d.append(el('div','tag','Painel de inspeção (original / tradução)'));v.pairs.forEach(q=>d.append(el('div','',q.id+'. "'+q.en+'" / "'+q.pt+'"')));s.append(d)}
 if(v.help)s.append(el('div','panel','Ajuda: '+v.help));
 const hum=v.mode==='humano'&&!v.done;
 const ob=el('div','btns');v.options.forEach(o=>{const b=el('button','opt'+(v.selected===o.id?' sel':''),'('+o.id+') '+o.label);b.disabled=!hum||!v.allowed.some(a=>a.id==='selecionar_'+o.id);b.onclick=()=>act('selecionar_'+o.id);ob.append(b)});s.append(ob);
 const ab=el('div','btns');v.allowed.filter(a=>!a.id.startsWith('selecionar_')).forEach(a=>{const b=el('button',a.id==='enviar'?'pri':'',a.label);b.disabled=!hum;b.onclick=()=>act(a.id);ab.append(b)});s.append(ab);
 if(v.mode==='agente'&&!v.done)s.append(el('p','tag',v.scene==='fim'?'Execução terminou; aguardando a verificação externa...':'O agente está operando a interface. Os botões ficam desabilitados.'));
 $('obs').textContent=v.observation;
 $('llm').textContent=v.agent&&v.agent.raw?('passo '+v.agent.step+': '+v.agent.raw+'\nação proposta: '+v.agent.proposal):(v.mode==='humano'?'(modo humano: sem LLM)':'(aguardando)');
 const ev=$('ev');ev.replaceChildren();v.events.forEach(e=>ev.append(el('div','ev','#'+e.seq+' '+e.origin+' · '+e.type+' '+JSON.stringify(e.data))));
 const r=$('res');r.replaceChildren();
 if(v.error)r.append(el('div','res bad','Erro: '+v.error));
 if(v.result){const ok=v.result.correct;const d=el('div','res '+(ok?'ok':'bad'));d.append(el('div','','Verificação externa: '+v.result.status+' · ações: '+v.result.executed_actions+' · hash '+v.result.hash));d.append(el('div','tag','O verificador lê o estado final; a afirmação do agente não conta.'));r.append(d)}
}
let timer=null,last='';
async function poll(){const v=await api('/api/state');if(v&&v.run_id){const k=JSON.stringify(v);if(k!==last){last=k;render(v)}}clearTimeout(timer);if(v&&v.run_id&&v.mode==='agente'&&!v.done)timer=setTimeout(poll,700)}
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        if self.path == "/":
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/api/state":
            self._json(SESSION.view() if SESSION else {})
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        global SESSION
        n = int(self.headers.get("Content-Length") or 0)
        data = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/api/new":
            SESSION = Session(data["task"], int(data["seed"]), data["mode"], data.get("policy", "random"))
            self._json({"ok": True})
        elif self.path == "/api/act":
            if SESSION:
                SESSION.act(data["action"])
            self._json({"ok": True})
        else:
            self._send(404, b"not found", "text/plain")

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Interface em http://127.0.0.1:{a.port}  (Ctrl+C para sair)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
