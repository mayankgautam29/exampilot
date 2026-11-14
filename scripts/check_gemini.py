import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import settings

if not settings.gemini_api_key:
    sys.exit("GEMINI_API_KEY is empty. Put your key in backend/.env first (it is git-ignored).")

from google import genai

client = genai.Client(api_key=settings.gemini_api_key)
models = [m.name.replace("models/", "") for m in client.models.list() if "generateContent" in (m.supported_actions or [])]
print(f"{len(models)} models can generate content for this key:")
for name in sorted(models):
    print("  ", name)

usable = []
for name in [settings.gemini_model] + settings.gemini_fallback_models + [m for m in models if "flash" in m][:6]:
    if name in usable or name not in models:
        continue
    try:
        reply = client.models.generate_content(model=name, contents="Reply with the single word: ready")
        print(f"OK   {name}: {(reply.text or '').strip()[:30]}")
        usable.append(name)
    except Exception as error:
        print(f"FAIL {name}: {str(error)[:90]}")
    if len(usable) == 3:
        break

if usable:
    print("\nSuggested backend/.env values:")
    print(f"GEMINI_MODEL={usable[0]}")
    print(f"GEMINI_FALLBACK_MODELS={','.join(usable[1:])}")
else:
    print("\nNo usable model found. ExamPilot still works in offline mode.")
