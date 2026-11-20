"""Cenas sintéticas PÚBLICAS: tudo o que o leitor humano e o agente podem perceber.

O gabarito e o caminho mínimo da HTA NÃO estão aqui: ficam em gabarito_private.json,
lido somente por verifier.py (analista). Apenas tarefas de calibração (C1, C2).
V1 e V2 permanecem congeladas e não existem neste código.
"""

SCENES = {
    "C1": {
        "id": "C1",
        "instruction": "Leia a cena e responda à pergunta.",
        "question": "Por que a personagem se atrasou?",
        "panels": [
            {"id": 1, "caption": "Mari entra correndo na sala de aula.",
             "en": "Mari, you are late again!", "pt": "Mari, você se atrasou de novo!",
             "highlighted": False},
            {"id": 2, "caption": "Mari responde, ofegante.",
             "en": "The bus broke down on Oak Street.", "pt": "O ônibus quebrou na Rua dos Carvalhos.",
             "highlighted": False},
            {"id": 3, "caption": "Mari mostra o tênis sujo de lama.",
             "en": "I had to walk the whole way.", "pt": "Tive que ir andando o caminho todo.",
             "highlighted": False},
            {"id": 4, "caption": "Mari se senta, envergonhada.",
             "en": "Sorry. I will leave earlier tomorrow.", "pt": "Desculpa. Vou sair mais cedo amanhã.",
             "highlighted": False},
        ],
        "options": [
            {"id": "a", "label": "Ela perdeu a hora."},
            {"id": "b", "label": "O ônibus quebrou."},
            {"id": "c", "label": "Estava chovendo muito."},
            {"id": "d", "label": "Ela esqueceu a mochila."},
        ],
    },
    "C2": {
        "id": "C2",
        "instruction": "Leia a cena e responda à pergunta sobre a fala destacada.",
        "question": "Qual sentido completa a fala destacada?",
        "panels": [
            {"id": 1, "caption": "Dois amigos conversam numa praça.",
             "en": "Tell me your plan.", "pt": "Conte-me seu plano.",
             "highlighted": False},
            {"id": 2, "caption": "O outro amigo se inclina para a frente.",
             "en": "I'm all ears.", "pt": "Estou todo orelhas.",
             "highlighted": True},
            {"id": 3, "caption": "O primeiro desenha um mapa no chão.",
             "en": "First, we find the key.", "pt": "Primeiro, achamos a chave.",
             "highlighted": False},
            {"id": 4, "caption": "Os dois olham para uma porta antiga.",
             "en": "Then we open the door.", "pt": "Depois, abrimos a porta.",
             "highlighted": False},
        ],
        "options": [
            {"id": "a", "label": "Estou ouvindo com dificuldade."},
            {"id": "b", "label": "Estou ouvindo de longe."},
            {"id": "c", "label": "Estou ouvindo o que dizem por aí."},
            {"id": "d", "label": "Estou ouvindo com atenção."},
        ],
    },
}
