import re

from app.config import REGULATIONS_PATH
from app.engine.rules import Rules, Weights, _raw


def candidates(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    forms = [str(value)]
    if isinstance(value, float) and value.is_integer():
        forms.append(str(int(value)))
    if isinstance(value, float) and 0 < value < 1:
        forms.append(str(int(round(value * 100))))
    return forms


def test_every_numeric_parameter_appears_in_regulations():
    text = REGULATIONS_PATH.read_text(encoding="utf-8")
    missing = []
    for key, value in _raw()["parameters"].items():
        if not any(re.search(rf"(?<![\w.]){re.escape(form)}(?!\w|\.\d)", text) for form in candidates(value)):
            missing.append(key)
    assert not missing, f"Parameters absent from regulations.md: {missing}"


def test_yaml_matches_models():
    raw = _raw()
    assert set(raw["parameters"]) == set(Rules.model_fields)
    assert set(raw["weights"]) == set(Weights.model_fields)


def test_regulations_have_enough_rules():
    text = REGULATIONS_PATH.read_text(encoding="utf-8")
    assert len(re.findall(r"^### R-\d+\.\d+", text, re.M)) >= 30
    assert "SYNTHETIC REGULATIONS FOR DEMO" in text
