import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = ROOT_DIR / "data"
SEED_DIR = DATA_DIR / "seed"
REGULATIONS_PATH = DATA_DIR / "regulations.md"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        DATA_DIR.mkdir(exist_ok=True)
        return f"sqlite:///{(DATA_DIR / 'exampilot.db').as_posix()}"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    jwt_hours: int
    frontend_origins: list[str]
    frontend_origin_regex: str
    gemini_api_key: str
    gemini_model: str
    gemini_fallback_models: list[str]
    llm_rpm: int
    llm_rpd: int
    solver_workers: int
    solver_time_limit_s: float
    seat_iterations: int
    auto_seed_on_empty: bool
    require_different_approver: bool
    seed: int
    scale: float
    exam_start_date: str


def load_settings() -> Settings:
    load_env_file(BACKEND_DIR / ".env")
    cpus = os.cpu_count() or 1
    workers = int(os.getenv("SOLVER_WORKERS", min(8, cpus) if cpus > 1 else 2))
    time_limit = float(os.getenv("SOLVER_TIME_LIMIT_S", 20 if cpus > 1 else 10))
    iterations = int(os.getenv("SEAT_ITERATIONS", 30000 if cpus > 1 else 8000))
    return Settings(
        database_url=database_url(),
        jwt_secret=os.getenv("JWT_SECRET", "dev-secret-change-me-please-0123456789"),
        jwt_hours=int(os.getenv("JWT_HOURS", 8)),
        frontend_origins=split_csv(os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")),
        frontend_origin_regex=os.getenv("FRONTEND_ORIGIN_REGEX", ""),
        gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        gemini_fallback_models=split_csv(os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.1-flash-lite,gemini-3.8-flash")),
        llm_rpm=int(os.getenv("LLM_RPM", 10)),
        llm_rpd=int(os.getenv("LLM_RPD", 400)),
        solver_workers=workers,
        solver_time_limit_s=time_limit,
        seat_iterations=iterations,
        auto_seed_on_empty=os.getenv("AUTO_SEED_ON_EMPTY", "true").lower() == "true",
        require_different_approver=os.getenv("REQUIRE_DIFFERENT_APPROVER", "false").lower() == "true",
        seed=int(os.getenv("SEED", 42)),
        scale=float(os.getenv("SCALE", 1)),
        exam_start_date=os.getenv("EXAM_START_DATE", "2026-12-07"),
    )


settings = load_settings()
