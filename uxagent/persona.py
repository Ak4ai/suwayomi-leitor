"""Mecanismos de persona FORA DO PROMPT (Atividade 2.2).

Parâmetros amostrados por execução, a partir de uma semente:
  c  cobertura lexical        ~ U(0,75; 0,90)
  k  janela de leitura        ~ DiscUnif{2, 3, 4}   (quadros visíveis ao mesmo tempo)
  u  limiar de apoio          ~ U(0,15; 0,30)
  v  estratégia compensatória ~ Bernoulli(0,70)     (checar a fonte antes de abrir o painel)
  d  precisão motora          ~ U(0,95; 1,00)

Esses valores alteram a OBSERVAÇÃO e as AÇÕES HABILITADAS; o prompt nunca diz ao
modelo como se comportar. Os valores são hipóteses de modelagem, não medições.
"""
import hashlib
import random
import re
from dataclasses import dataclass, asdict

WORD = re.compile(r"[A-Za-z']+")


@dataclass
class Persona:
    seed: int
    c: float
    k: int
    u: float
    v: bool
    d: float

    def params(self) -> dict:
        return asdict(self)

    def knows(self, word: str) -> bool:
        """Palavra inglesa conhecida? Determinística por (semente, palavra)."""
        h = hashlib.sha256(f"{self.seed}:{word.lower()}".encode("utf-8")).hexdigest()
        return int(h[:8], 16) / 0xFFFFFFFF < self.c

    def mask(self, text: str) -> tuple[str, int, int]:
        """Mascara palavras fora da cobertura. Devolve (texto, mascaradas, total)."""
        masked = total = 0

        def repl(m):
            nonlocal masked, total
            total += 1
            if self.knows(m.group(0)):
                return m.group(0)
            masked += 1
            return "[?]"

        return WORD.sub(repl, text), masked, total

    def uncertainty(self, text: str) -> float:
        _, masked, total = self.mask(text)
        return masked / total if total else 0.0

    def help_eligible(self, text: str) -> bool:
        return self.uncertainty(text) > self.u

    def motor_rng(self) -> random.Random:
        return random.Random(f"motor:{self.seed}")


def sample_persona(seed: int) -> Persona:
    rng = random.Random(f"persona:{seed}")
    return Persona(
        seed=seed,
        c=round(rng.uniform(0.75, 0.90), 4),
        k=rng.choice([2, 3, 4]),
        u=round(rng.uniform(0.15, 0.30), 4),
        v=rng.random() < 0.70,
        d=round(rng.uniform(0.95, 1.00), 4),
    )
