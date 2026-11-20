"""Políticas de ação: comparador aleatório (neutro) e agente LLM local (Qwen).

O prompt contém SOMENTE: a metamensagem ao agente, o formato de resposta e a observação o_t
(que já traz as ações habilitadas). Nunca contém HTA, CTT, KLM, gabarito, critério de sucesso
nem os parâmetros da persona.
"""
import json
import random
import re

SYSTEM_PROMPT = (
    "Você recebe uma descrição textual equivalente aos signos observáveis da tela e a lista das ações habilitadas. "
    "Escolha somente uma ação. Ajuda é entregue apenas quando solicitada. "
    'Responda apenas com JSON no formato {"acao": "<id_da_acao>"}, usando exatamente um id da lista de AÇÕES POSSÍVEIS.'
)

ACTION_JSON = re.compile(r'"acao"\s*:\s*"([^"]+)"')


def parse_action(raw: str, allowed_ids: list[str]):
    """Extrai a ação proposta. Devolve None se não houver proposta reconhecível."""
    m = ACTION_JSON.search(raw)
    if m:
        return m.group(1).strip()
    for aid in sorted(allowed_ids, key=len, reverse=True):  # fallback: id citado no texto
        if re.search(rf"\b{re.escape(aid)}\b", raw):
            return aid
    return None


class RandomPolicy:
    """Comparador neutro: sorteia uma ação habilitada. Testa o protocolo, não a capacidade do LLM."""
    name = "random"

    def __init__(self):
        self._rng = {}

    def propose(self, obs, allowed_ids, seed, step):
        rng = self._rng.setdefault(seed, random.Random(f"policy:{seed}"))
        action = rng.choice(allowed_ids)
        return {"action": action, "raw": json.dumps({"acao": action}), "request": None}


class GroqPolicy:
    """Agente LLM via API do Groq (compatível com OpenAI). A chave vem de GROQ_API_KEY (nunca do código)."""
    name = "groq"
    URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, model: str = "openai/gpt-oss-120b", temperature: float = 0.0,
                 max_tokens: int = 700, reasoning_effort: str = "low"):
        import os
        self.key = os.environ.get("GROQ_API_KEY")
        if not self.key:
            raise RuntimeError("Defina a variável de ambiente GROQ_API_KEY.")
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.reasoning_effort = reasoning_effort

    def _post(self, payload: dict) -> dict:
        import time
        import urllib.error
        import urllib.request
        body = json.dumps(payload).encode("utf-8")
        for attempt in range(8):
            req = urllib.request.Request(self.URL, data=body, method="POST", headers={
                "Authorization": f"Bearer {self.key}", "Content-Type": "application/json",
                "User-Agent": "uxagent-pilot/1.0"})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503) and attempt < 7:
                    wait = float(e.headers.get("retry-after") or 0) or min(60, 2 ** attempt)
                    time.sleep(wait)
                    continue
                raise RuntimeError(f"Groq HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")

    def propose(self, obs, allowed_ids, seed, step):
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": obs}]
        payload = {"model": self.model, "messages": messages, "temperature": self.temperature,
                   "max_completion_tokens": self.max_tokens, "seed": seed * 1000 + step}
        if "gpt-oss" in self.model:
            payload["reasoning_effort"] = self.reasoning_effort
        data = self._post(payload)
        raw = data["choices"][0]["message"].get("content") or ""
        return {"action": parse_action(raw, allowed_ids), "raw": raw, "request": messages,
                "meta": {"model": data.get("model"), "usage": data.get("usage")}}


class QwenPolicy:
    """Agente LLM local. Geração gulosa (temperatura 0) por padrão, para reprodutibilidade."""
    name = "qwen"

    def __init__(self, model_path: str, temperature: float = 0.0, max_new_tokens: int = 48,
                 offload: bool = False):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.torch = torch
        self.model_path = model_path
        self.temperature = temperature
        self.max_new_tokens = max_new_tokens
        self.tok = AutoTokenizer.from_pretrained(model_path)
        if offload:  # modelo maior que a GPU: camadas divididas entre GPU e CPU (fp16, sem quantização)
            self.model = AutoModelForCausalLM.from_pretrained(
                model_path, dtype=torch.float16, device_map="auto",
                max_memory={0: "4400MiB", "cpu": "20GiB"})
        else:
            self.model = AutoModelForCausalLM.from_pretrained(model_path, dtype=torch.float16).to("cuda")
        self.model.eval()

    def propose(self, obs, allowed_ids, seed, step):
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": obs}]
        text = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self.tok(text, return_tensors="pt").to("cuda")
        kwargs = dict(max_new_tokens=self.max_new_tokens, pad_token_id=self.tok.eos_token_id)
        if self.temperature > 0:
            self.torch.manual_seed(seed * 1000 + step)
            kwargs.update(do_sample=True, temperature=self.temperature)
        else:
            kwargs.update(do_sample=False, temperature=None, top_p=None, top_k=None)
        with self.torch.no_grad():
            out = self.model.generate(**inputs, **kwargs)
        raw = self.tok.decode(out[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True)
        return {"action": parse_action(raw, allowed_ids), "raw": raw, "request": messages}
