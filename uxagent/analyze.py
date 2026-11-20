"""Análise dos logs do piloto (código do ANALISTA; nunca importado pelo agente).

Lê somente os arquivos .jsonl de uma pasta de execução e calcula:
  S   sucesso = corretas / válidas           (falha técnica sai do denominador; travamento NÃO sai)
  U   uso de suporte = execuções válidas com >= 1 apoio / válidas
  A   ações executadas; A_x = excesso sobre o caminho mínimo da HTA
  Re  erros por oportunidade = (propostas rejeitadas + deslizes motores + resposta incorreta) / propostas do agente
  rupturas (MAC) detectadas SOMENTE por assinaturas no log (nunca pelo discurso do LLM)
  KLM tempo equivalente do caminho executado vs. caminho do especialista (linha de base ideal)

Uso:  python analyze.py data\\groq_pilot
"""
import json
import sys
from collections import Counter
from pathlib import Path

GABARITO = json.loads((Path(__file__).with_name("gabarito_private.json")).read_text(encoding="utf-8"))
SUPPORT = {"alternar_balao", "mostrar_original", "abrir_painel", "pedir_ajuda"}

# KLM (Card, Moran e Newell, 1980): K, P, M; R é suposição deste projeto (resposta visual local)
K, P, M, R = 0.20, 1.10, 1.35, 0.30
EXPERT = {  # caminho do especialista por tarefa (HTA congelada, lado do analista)
    "C1": ["ler_proximo", "selecionar", "enviar"],
    "C2": ["ler_proximo", "alternar_balao", "selecionar", "enviar"],
}


def klm_cost(action: str) -> float:
    a = "selecionar" if action.startswith("selecionar_") else action
    if a == "selecionar":
        return M + P + K
    if a == "pedir_ajuda" or a.startswith("ajuda_"):
        return P + K + R
    return P + K


def klm_time(actions: list[str]) -> float:
    return M + sum(klm_cost(a) for a in actions)  # M inicial: preparação mental da tarefa


def norm(a: str) -> str:
    return "selecionar" if a.startswith("selecionar_") else a


def edit_distance(a: list[str], b: list[str]) -> int:
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (x != y))
    return d[len(b)]


def parse_run(path: Path) -> dict:
    ev = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    task = ev[0]["task"]
    ver = next(e["data"] for e in reversed(ev) if e["type"] == "verification")
    executed = [e["data"]["executed"] for e in ev if e["type"] == "action_executed"]
    decisions = sum(1 for e in ev if e["type"] == "llm_response")
    rejected = sum(1 for e in ev if e["type"] == "action_rejected")
    slips = sum(1 for e in ev if e["type"] == "motor_slip")
    supports = [a for a in executed if a in SUPPORT]
    helps = [e["data"]["type"] for e in ev if e["type"] == "help_delivered"]
    highlighted_seen = any("[fala destacada]" in e["data"]["text"] for e in ev if e["type"] == "observation")
    # ---- rupturas por assinatura no log ----
    sig = Counter()
    sig["acao_inexistente"] += rejected
    for h in helps:
        sig[{"ajuda_navegacao": "onde_estou", "ajuda_traducao": "o_que_posso_fazer"}.get(h, "ajuda_tarefa")] += 1
    run = 0
    for a in executed + [""]:
        run = run + 1 if a == "alternar_balao" else 0
        if run == 3:
            sig["alternancia_repetida"] += 1
    if ver["status"] == "quit":
        sig["desisto"] += 1
    if ver["status"] == "stalled":
        sig["travamento"] += 1
    submitted = "enviar" in executed
    if submitted and highlighted_seen and not any(a in SUPPORT for a in executed[:executed.index("enviar")]):
        sig["resposta_sem_inspecao"] += 1
    gab_min = GABARITO[task]["min_actions"]
    if submitted and len(executed) < gab_min:
        sig["atalho_menos_acoes_que_o_minimo"] += 1
    errors = rejected + slips + (1 if ver["status"] == "incorrect" else 0)
    return {"run": path.stem, "task": task, "seed": ev[0]["seed"], "status": ver["status"],
            "valid": ver["valid_run"], "correct": ver["correct"], "executed": executed,
            "n_exec": len(executed), "excess": ver["excess_actions"], "decisions": decisions,
            "errors": errors, "support": len(supports) > 0, "signatures": dict(sig),
            "klm_exec": round(klm_time(executed), 2),
            "klm_dist": edit_distance([norm(a) for a in executed], EXPERT[task])}


def main(folder: str):
    d = Path(folder)
    runs = [parse_run(p) for p in sorted(d.glob("*_C*_s*.jsonl"))]
    cfg = json.loads((d / "config.json").read_text(encoding="utf-8")) if (d / "config.json").exists() else {}
    out = {"pasta": str(d), "config": cfg, "tarefas": {}}
    for task in sorted({r["task"] for r in runs}):
        rs = [r for r in runs if r["task"] == task]
        v = [r for r in rs if r["valid"]]
        done = [r for r in v if r["status"] in ("correct", "incorrect")]
        sig = Counter()
        for r in rs:
            sig.update(r["signatures"])
        exp = klm_time(EXPERT[task])
        out["tarefas"][task] = {
            "iniciadas": len(rs), "validas": len(v), "falhas_tecnicas": len(rs) - len(v),
            "S": round(sum(r["correct"] for r in v) / len(v), 3) if v else None,
            "U": round(sum(r["support"] for r in v) / len(v), 3) if v else None,
            "A_media": round(sum(r["n_exec"] for r in v) / len(v), 2) if v else None,
            "A_min_HTA": GABARITO[task]["min_actions"],
            "Ax_media": round(sum(r["excess"] for r in v) / len(v), 2) if v else None,
            "Re": round(sum(r["errors"] for r in v) / max(1, sum(r["decisions"] for r in v)), 3) if v else None,
            "status": dict(Counter(r["status"] for r in rs)),
            "rupturas_por_assinatura": dict(sig),
            "KLM_especialista_s": round(exp, 2),
            "KLM_executado_medio_s": round(sum(r["klm_exec"] for r in done) / len(done), 2) if done else None,
            "dist_edicao_media_ao_especialista": round(sum(r["klm_dist"] for r in done) / len(done), 2) if done else None,
            "sequencias_distintas": len({tuple(r["executed"]) for r in rs}),
        }
    (d / "analysis.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    cols = ["iniciadas", "validas", "S", "U", "A_media", "A_min_HTA", "Ax_media", "Re",
            "KLM_especialista_s", "KLM_executado_medio_s", "dist_edicao_media_ao_especialista", "sequencias_distintas"]
    lines = ["| tarefa | " + " | ".join(cols) + " |", "|" + "---|" * (len(cols) + 1)]
    for t, v in out["tarefas"].items():
        lines.append(f"| {t} | " + " | ".join(str(v[c]) for c in cols) + " |")
    (d / "analysis.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    for t, v in out["tarefas"].items():
        print(t, "status:", v["status"], "| rupturas:", v["rupturas_por_assinatura"])


if __name__ == "__main__":
    main(sys.argv[1])
