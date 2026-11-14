import pytest

from app.agent import rag

IN_SCOPE = [
    ("How many exams can a student take in one day?", "R-2.1"),
    ("What time does the morning session start?", "R-1.1"),
    ("Can I use my mobile phone in the exam hall?", "R-7.4"),
    ("When must students report to the room?", "R-7.1"),
    ("Until when is late entry allowed?", "R-7.2"),
    ("How full can a room be?", "R-3.1"),
    ("Where are extra time students seated?", "R-3.4"),
    ("How many invigilators are needed for a room?", "R-4.1"),
    ("Can a teacher invigilate their own course?", "R-4.2"),
    ("How many duties can a faculty member have in a day?", "R-4.4"),
    ("How many relievers are kept per session?", "R-4.5"),
    ("Who approves the timetable before publication?", "R-6.1"),
    ("Are calculators allowed?", "R-7.5"),
    ("What happens if the timetable is impossible with one exam per day?", "R-2.3"),
    ("How are seats numbered?", "R-5.4"),
    ("Can students use calculators?", "R-7.5"),
]

OUT_OF_SCOPE = [
    "What is the exam fee?",
    "How do I apply for revaluation?",
    "What are the hostel rules during exams?",
    "How are grades calculated?",
    "Is there a scholarship for toppers?",
    "What is the refund policy for fees?",
    "Where can I park my car?",
    "How is the placement process handled?",
]


@pytest.mark.parametrize("question,rule", IN_SCOPE)
def test_in_scope_questions_cite_the_right_rule(question, rule):
    answer = rag.answer_question(question)
    assert answer["grounded"]
    assert rule in answer["answer"]
    assert rule in answer["citations"]


@pytest.mark.parametrize("question", OUT_OF_SCOPE)
def test_out_of_scope_questions_are_refused(question):
    answer = rag.answer_question(question)
    assert not answer["grounded"]
    assert answer["answer"] == "Not covered in the approved regulations."


def test_hallucinated_llm_answers_are_rejected():
    chunks = rag.search("How many exams can a student take in one day?")["chunks"]
    assert rag.check_answer("A student may sit 1 exam per day [R-2.1].", chunks)
    assert not rag.check_answer("A student may sit 3 exams per day [R-2.1].", chunks)
    assert not rag.check_answer("A student may sit 1 exam per day [R-9.9].", chunks)
    assert not rag.check_answer("A student may sit 1 exam per day.", chunks)


class LyingLLM:
    def available(self):
        return True

    def complete(self, prompt, system="", cache=False):
        return "A student may sit 5 exams a day [R-2.1]."


def test_answer_falls_back_to_extractive_when_llm_lies():
    answer = rag.answer_question("How many exams can a student take in one day?", LyingLLM())
    assert answer["mode"] == "extractive"
    assert "5" not in answer["answer"]
