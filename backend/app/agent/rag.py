from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from rank_bm25 import BM25Okapi

from ..config import REGULATIONS_PATH

REFUSAL = "Not covered in the approved regulations."
SUGGESTION = "Please contact the Controller of Examinations for this question."
MIN_SCORE = 1.0
MIN_COVERAGE = 0.6

STOPWORDS = set("""a an the is are was were be been am do does did can could should would may might shall will what which who whom whose when where why how
of in on at to for from by with and or not no nor as if it its this that these those there their they them i my me we our you your he she his her
please tell about any some many much more most than then also just only into out up down over under again per take taken kept keep keeps happen happens have has had""".split())

GENERIC = set("""exam exams examination examinations rule rules regulation regulations policy policies allowed allow permitted permit student students
required require need needs must limit maximum minimum number during hall room rooms session sessions during day days get give time times""".split())

SYNONYMS = {
    "used": "use", "uses": "use", "using": "use",
    "morning": "s1", "forenoon": "s1", "afternoon": "s2", "phone": "mobile", "phones": "mobile", "cellphone": "mobile", "smartwatch": "watches",
    "late": "late", "id": "identity", "card": "card", "calculator": "calculators", "cheating": "malpractice", "cheat": "malpractice",
    "one": "1", "two": "2", "full": "fill", "disabled": "accessible", "wheelchair": "accessible", "disability": "accessible", "begin": "runs", "begins": "runs", "start": "runs", "starts": "runs", "seated": "placed", "sitting": "placed", "end": "ends",
}


def stem(word: str) -> str:
    for suffix in ("ing", "ies", "es", "ed", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return word


def tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+(?:[.:][0-9]+)?", text.lower())
    return [stem(SYNONYMS.get(w, w)) for w in words if w not in STOPWORDS]


@dataclass
class Chunk:
    id: str
    title: str
    text: str


@lru_cache(maxsize=1)
def load_chunks() -> tuple[Chunk, ...]:
    text = REGULATIONS_PATH.read_text(encoding="utf-8")
    chunks: list[Chunk] = []
    for match in re.finditer(r"^### (R-\d+\.\d+) (.+?)\n(.*?)(?=^#{2,3} |\Z)", text, re.S | re.M):
        chunks.append(Chunk(match.group(1), match.group(2).strip(), match.group(3).strip()))
    return tuple(chunks)


@lru_cache(maxsize=1)
def index() -> tuple[BM25Okapi, list[list[str]]]:
    corpus = [tokenize(f"{c.title} {c.title} {c.text}") for c in load_chunks()]
    return BM25Okapi(corpus), corpus


def search(query: str, top_k: int = 3) -> dict:
    bm25, corpus = index()
    chunks = load_chunks()
    tokens = tokenize(query)
    specific = [t for t in tokens if t not in {stem(g) for g in GENERIC}]
    scores = bm25.get_scores(tokens) if tokens else [0.0] * len(chunks)
    ranked = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)[:top_k]
    results = [{"id": chunks[i].id, "title": chunks[i].title, "text": chunks[i].text, "score": round(float(scores[i]), 2)} for i in ranked]
    best = ranked[0] if ranked else None
    coverage = 0.0
    if best is not None and specific:
        vocabulary = set(corpus[best])
        coverage = sum(1 for t in specific if t in vocabulary) / len(specific)
    grounded = best is not None and bool(specific) and scores[best] >= MIN_SCORE and coverage >= MIN_COVERAGE
    return {"grounded": grounded, "coverage": round(coverage, 2), "chunks": results if grounded else []}


def numbers_in(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:[.:]\d+)?", text))


def check_answer(answer: str, chunks: list[dict]) -> bool:
    allowed_ids = {c["id"] for c in chunks}
    cited = set(re.findall(r"R-\d+\.\d+", answer))
    if not cited or not cited <= allowed_ids:
        return False
    source = " ".join(c["text"] + " " + c["title"] + " " + c["id"] for c in chunks if c["id"] in cited)
    return numbers_in(re.sub(r"R-\d+\.\d+", "", answer)) <= numbers_in(source)


def extractive_answer(chunks: list[dict]) -> str:
    best = chunks[0]
    return f"{best['text']} [{best['id']}]"


def answer_question(question: str, llm=None) -> dict:
    found = search(question)
    if not found["grounded"]:
        return {"answer": REFUSAL, "note": SUGGESTION, "citations": [], "grounded": False, "mode": "refused"}
    chunks = found["chunks"]
    if llm is not None and llm.available():
        prompt = (
            "Answer the question using ONLY the regulation excerpts below. Cite every rule you use as [R-x.y]. "
            "Do not add numbers or facts that are not in the excerpts. Keep it under 80 words.\n\n"
            + "\n".join(f"[{c['id']}] {c['title']}: {c['text']}" for c in chunks)
            + f"\n\nQuestion: {question}"
        )
        try:
            text = llm.complete(prompt, system="You answer examination policy questions strictly from the supplied excerpts.", cache=True)
            if check_answer(text, chunks):
                return {"answer": text.strip(), "citations": sorted(set(re.findall(r"R-\d+\.\d+", text))), "grounded": True, "mode": "llm"}
        except Exception:
            pass
    return {"answer": extractive_answer(chunks), "citations": [chunks[0]["id"]], "grounded": True, "mode": "extractive"}
