"""Interface experimental instrumentada (Atividade 2.1) e máquina de estados MoLIC.

Cenas (MoLIC): leitura, painel, ajuda, resposta_selecionada, fim.
As falas u: de cada cena definem as ações habilitadas; as falas d: são a observação
textual (paridade de signos com a tela do leitor humano).

Este módulo NÃO conhece o gabarito nem a HTA/CTT/KLM. Só o verificador (verifier.py) lê o gabarito.
"""
from persona import Persona

LEITURA, PAINEL, AJUDA, RESPOSTA, FIM = "leitura", "painel", "ajuda", "resposta_selecionada", "fim"

HELP_TEXT = {
    "ajuda_navegacao": "Use ler_proximo e ler_anterior para mover o quadro em foco. A janela de leitura "
                       "mostra poucos quadros por vez; o painel mostra todos os pares original/tradução.",
    "ajuda_traducao": "Cada balão mostra a tradução ou o original. alternar_balao troca a versão do balão em foco; "
                      "mostrar_original troca a página inteira. Palavras marcadas com [?] não são conhecidas por você.",
    "ajuda_tarefa": "Leia a cena, escolha uma alternativa e envie. Não há dica sobre qual alternativa é correta.",
}

SUPPORT_ACTIONS = {"alternar_balao", "mostrar_original", "abrir_painel", "pedir_ajuda"}


class Environment:
    def __init__(self, scene: dict, persona: Persona):
        self.scene = scene
        self.p = persona
        self.n = len(scene["panels"])
        self.state = LEITURA
        self.focus = 0
        self.version = {pn["id"]: "pt" for pn in scene["panels"]}
        self.page_original = False
        self.selected = None
        self.submitted = None
        self.quit = False
        self.help_shown = None
        self._return_state = LEITURA
        self.checked_source = False
        self.supports_used: list[str] = []
        self.executed = 0
        self.history: list[str] = []
        self._motor = persona.motor_rng()

    # ------------------------------------------------------------------ estado
    @property
    def terminal(self) -> bool:
        return self.state == FIM

    def snapshot(self) -> dict:
        return {"scene": self.state, "focus": self.focus, "page_original": self.page_original,
                "selected": self.selected, "submitted": self.submitted, "quit": self.quit,
                "versions": dict(self.version)}

    def _visible(self) -> range:
        return range(max(0, self.focus - self.p.k + 1), self.focus + 1)

    def _balloon_text(self, idx: int) -> tuple[str, str]:
        pn = self.scene["panels"][idx]
        ver = "en" if (self.page_original or self.version[pn["id"]] == "en") else "pt"
        if ver == "pt":
            return pn["pt"], "tradução"
        masked, _, _ = self.p.mask(pn["en"])
        return masked, "original"

    # ------------------------------------------------------------------ ações
    def _select_ids(self):
        return [(f"selecionar_{o['id']}",
                 f"Marcar a alternativa ({o['id']})" + (" - já marcada" if o["id"] == self.selected else ""))
                for o in self.scene["options"]]

    def _help_ok(self) -> bool:
        focus_en = self.scene["panels"][self.focus]["en"]
        return self.p.help_eligible(focus_en)

    def allowed(self) -> list[tuple[str, str]]:
        s = self.state
        a: list[tuple[str, str]] = []
        if s == LEITURA:
            if self.focus < self.n - 1:
                a.append(("ler_proximo", "Ler o próximo quadro"))
            if self.focus > 0:
                a.append(("ler_anterior", "Voltar ao quadro anterior"))
            a.append(("alternar_balao", "Alternar o balão em foco entre tradução e original"))
            a.append(("mostrar_original", "Mostrar/ocultar a página original inteira"))
            if (not self.p.v) or self.checked_source:
                a.append(("abrir_painel", "Abrir o painel de inspeção (pares original/tradução)"))
            if self._help_ok():
                a.append(("pedir_ajuda", "Pedir ajuda"))
            a += self._select_ids()
            a.append(("desistir", "Desistir da tarefa"))
        elif s == PAINEL:
            a.append(("fechar_painel", "Fechar o painel"))
            a.append(("alternar_balao", "Alternar o balão em foco entre tradução e original"))
            if self._help_ok():
                a.append(("pedir_ajuda", "Pedir ajuda"))
            a += self._select_ids()
        elif s == AJUDA:
            # o tipo de ajuda que já está na tela não é reaberto (não faz nada numa tela real)
            for aid, label in (("ajuda_navegacao", "Ajuda sobre navegação"),
                               ("ajuda_traducao", "Ajuda sobre tradução"),
                               ("ajuda_tarefa", "Ajuda sobre a tarefa")):
                if aid != self.help_shown:
                    a.append((aid, label))
            a.append(("fechar_ajuda", "Fechar a ajuda"))
        elif s == RESPOSTA:
            a.append(("enviar", "Enviar a resposta para verificação externa"))
            # remarcar a alternativa já marcada não faz nada numa tela real: não é ação habilitada
            a += [x for x in self._select_ids() if x[0] != f"selecionar_{self.selected}"]
            a.append(("voltar_leitura", "Voltar à leitura"))
            a.append(("desistir", "Desistir da tarefa"))
        return a

    def apply(self, action_id: str) -> dict:
        """Aplica uma ação JÁ validada. Devolve metadados (inclui deslize motor, se houver)."""
        before = self.snapshot()
        meta: dict = {"requested": action_id, "executed_action": action_id}
        if action_id.startswith("selecionar_"):
            opts = [o["id"] for o in self.scene["options"]]
            chosen = action_id.split("_", 1)[1]
            if self._motor.random() > self.p.d:  # deslize motor: alvo vizinho
                i = opts.index(chosen)
                chosen2 = opts[(i + 1) % len(opts)]
                meta["motor_slip"] = {"intended": chosen, "executed": chosen2}
                chosen = chosen2
            meta["executed_action"] = f"selecionar_{chosen}"
            self.selected = chosen
            self.state = RESPOSTA
        elif action_id == "ler_proximo":
            self.focus = min(self.n - 1, self.focus + 1)
        elif action_id == "ler_anterior":
            self.focus = max(0, self.focus - 1)
        elif action_id == "alternar_balao":
            pid = self.scene["panels"][self.focus]["id"]
            self.version[pid] = "en" if self.version[pid] == "pt" else "pt"
            self.checked_source = True
        elif action_id == "mostrar_original":
            self.page_original = not self.page_original
            self.checked_source = True
        elif action_id == "abrir_painel":
            self.state = PAINEL
            self.checked_source = True
        elif action_id == "fechar_painel":
            self.state = LEITURA
        elif action_id == "pedir_ajuda":
            self._return_state = self.state
            self.state = AJUDA
            self.help_shown = None
        elif action_id in HELP_TEXT:
            self.help_shown = action_id
        elif action_id == "fechar_ajuda":
            self.state = self._return_state
            self.help_shown = None
        elif action_id == "voltar_leitura":
            self.state = LEITURA
        elif action_id == "enviar":
            self.submitted = self.selected
            self.state = FIM
        elif action_id == "desistir":
            self.quit = True
            self.state = FIM
        meta["support"] = action_id in SUPPORT_ACTIONS
        if meta["support"]:
            self.supports_used.append(action_id)
        self.executed += 1
        self.history.append(meta["executed_action"])
        meta["state_before"], meta["state_after"] = before, self.snapshot()
        return meta

    # ------------------------------------------------------------------ observação o_t
    def observe(self) -> str:
        sc = self.scene
        out = [f"TAREFA: {sc['instruction']}", f"PERGUNTA: {sc['question']}",
               f"CENA ATUAL: {self.state} | quadro em foco: {self.focus + 1} de {self.n}", "", "QUADROS:"]
        vis = set(self._visible())
        for i, pn in enumerate(sc["panels"]):
            if i in vis:
                text, ver = self._balloon_text(i)
                mark = " [fala destacada]" if pn["highlighted"] else ""
                out.append(f"  Quadro {pn['id']} - {pn['caption']} Balão ({ver}){mark}: \"{text}\"")
            elif i > self.focus:
                out.append(f"  Quadro {pn['id']} - ainda não lido.")
            else:
                out.append(f"  Quadro {pn['id']} - já lido, fora da janela de leitura.")
        if self.state == PAINEL:
            out += ["", "PAINEL DE INSPEÇÃO (original / tradução):"]
            for pn in sc["panels"]:
                masked, _, _ = self.p.mask(pn["en"])
                out.append(f"  Quadro {pn['id']}: original \"{masked}\" / tradução \"{pn['pt']}\"")
        if self.state == AJUDA:
            out += ["", "AJUDA: escolha um tipo de dúvida."]
            if self.help_shown:
                out.append(f"  {HELP_TEXT[self.help_shown]}")
        out += ["", "ALTERNATIVAS:"] + [f"  ({o['id']}) {o['label']}" for o in sc["options"]]
        if self.selected:
            out.append(f"Alternativa marcada: ({self.selected})")
        if self.state == RESPOSTA:
            out.append("BOTÃO NA TELA: [Enviar resposta] (ação: enviar) - encerra a tarefa e envia a alternativa marcada.")
        if self.history:
            out += ["", "AÇÕES RECENTES: " + ", ".join(self.history[-4:])]
        out += ["", "AÇÕES POSSÍVEIS:"] + [f"  {aid}: {label}" for aid, label in self.allowed()]
        return "\n".join(out)

    def observation_audit(self) -> dict:
        """Dados de auditoria dos mecanismos (vão para o log, não para o agente)."""
        focus_en = self.scene["panels"][self.focus]["en"]
        return {"visible_panels": [self.scene["panels"][i]["id"] for i in self._visible()],
                "focus_uncertainty": round(self.p.uncertainty(focus_en), 4),
                "help_eligible": self._help_ok(),
                "panel_gate_open": (not self.p.v) or self.checked_source}
