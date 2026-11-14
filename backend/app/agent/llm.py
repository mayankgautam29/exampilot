from __future__ import annotations

import hashlib
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import date

from sqlmodel import select

from ..config import settings
from ..db import new_session
from ..models.tables import LLMUsage


class LLMError(Exception):
    pass


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict


@dataclass
class ToolCall:
    name: str
    args: dict


@dataclass
class LLMResponse:
    text: str
    tool_calls: list[ToolCall]
    model: str
    raw: object = None


@dataclass
class Message:
    role: str
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    name: str = ""
    result: dict = field(default_factory=dict)
    raw: object = None


class TokenBucket:
    def __init__(self, per_minute: int):
        self.capacity = max(1, per_minute)
        self.tokens = float(self.capacity)
        self.updated = time.time()
        self.lock = threading.Lock()

    def acquire(self, wait_up_to: float = 15.0) -> bool:
        deadline = time.time() + wait_up_to
        while True:
            with self.lock:
                current = time.time()
                self.tokens = min(self.capacity, self.tokens + (current - self.updated) * self.capacity / 60.0)
                self.updated = current
                if self.tokens >= 1:
                    self.tokens -= 1
                    return True
            if time.time() >= deadline:
                return False
            time.sleep(0.25)


def retry_delay_seconds(message: str) -> float:
    match = re.search(r"retry(?:Delay)?\D{0,12}(\d+(?:\.\d+)?)\s*s", message, re.I)
    return min(float(match.group(1)), 20.0) if match else 2.0


class GeminiLLM:
    def __init__(self) -> None:
        self.key = settings.gemini_api_key
        self.models = [settings.gemini_model] + settings.gemini_fallback_models
        self.bucket = TokenBucket(settings.llm_rpm)
        self.failures = 0
        self.open_until = 0.0
        self.last_model = settings.gemini_model
        self.cache: dict[str, str] = {}
        self.thinking_supported = True
        self.client = None
        self.lock = threading.Lock()

    def client_handle(self):
        if self.client is None:
            from google import genai

            self.client = genai.Client(api_key=self.key)
        return self.client

    def configured(self) -> bool:
        return bool(self.key)

    def available(self) -> bool:
        return self.configured() and time.time() >= self.open_until and self.calls_today() < settings.llm_rpd

    def calls_today(self) -> int:
        with new_session() as session:
            rows = session.exec(select(LLMUsage).where(LLMUsage.date == date.today().isoformat())).all()
            return sum(r.calls for r in rows)

    def status(self) -> dict:
        used = self.calls_today()
        remaining = max(0, settings.llm_rpd - used)
        if not self.configured() or time.time() < self.open_until:
            mode = "offline"
        elif self.failures > 0 or self.last_model != self.models[0] or remaining < settings.llm_rpd * 0.1:
            mode = "degraded"
        else:
            mode = "live"
        return {"mode": mode, "model": self.last_model if self.configured() else None, "calls_today": used, "daily_limit": settings.llm_rpd, "remaining_est": remaining, "rpm": settings.llm_rpm}

    def record(self, model: str, tokens_in: int, tokens_out: int) -> None:
        with new_session() as session:
            row = session.get(LLMUsage, (date.today().isoformat(), model))
            if row is None:
                row = LLMUsage(date=date.today().isoformat(), model=model)
            row.calls += 1
            row.tokens_in += tokens_in
            row.tokens_out += tokens_out
            session.add(row)
            session.commit()

    def build_contents(self, messages: list[Message]):
        from google.genai import types

        contents = []
        pending: list = []
        for message in messages:
            if message.role == "tool":
                pending.append(types.Part.from_function_response(name=message.name, response=message.result))
                continue
            if pending:
                contents.append(types.Content(role="user", parts=pending))
                pending = []
            if message.role == "model" and message.raw is not None:
                contents.append(message.raw)
            elif message.role == "model":
                parts = [types.Part(function_call=types.FunctionCall(name=c.name, args=c.args)) for c in message.tool_calls]
                contents.append(types.Content(role="model", parts=parts or [types.Part(text=message.text)]))
            else:
                contents.append(types.Content(role="user", parts=[types.Part(text=message.text)]))
        if pending:
            contents.append(types.Content(role="user", parts=pending))
        return contents

    def call_model(self, model: str, messages: list[Message], system: str, tools: list[ToolSpec] | None, force: list[str] | None) -> LLMResponse:
        from google.genai import types

        config_args: dict = {"system_instruction": system, "temperature": 0.2}
        if tools:
            config_args["tools"] = [types.Tool(function_declarations=[types.FunctionDeclaration(name=t.name, description=t.description, parameters_json_schema=t.parameters) for t in tools])]
            config_args["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(disable=True)
            if force:
                config_args["tool_config"] = types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode="ANY", allowed_function_names=force))
        if self.thinking_supported:
            config_args["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        response = self.client_handle().models.generate_content(model=model, contents=self.build_contents(messages), config=types.GenerateContentConfig(**config_args))
        calls = [ToolCall(c.name, dict(c.args or {})) for c in (response.function_calls or [])]
        text = ""
        if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
            text = "".join(p.text for p in response.candidates[0].content.parts if getattr(p, "text", None) and not getattr(p, "thought", False))
        usage = getattr(response, "usage_metadata", None)
        self.record(model, getattr(usage, "prompt_token_count", 0) or 0, getattr(usage, "candidates_token_count", 0) or 0)
        raw = response.candidates[0].content if response.candidates else None
        return LLMResponse(text=text, tool_calls=calls, model=model, raw=raw)

    def chat(self, messages: list[Message], system: str, tools: list[ToolSpec] | None = None, force: list[str] | None = None) -> LLMResponse:
        if not self.available():
            raise LLMError("AI is offline")
        last_error: Exception | None = None
        for model in self.models:
            for attempt in range(2):
                if not self.bucket.acquire():
                    raise LLMError("Rate limit reached for the AI model")
                try:
                    response = self.call_model(model, messages, system, tools, force)
                    self.failures = 0
                    self.last_model = model
                    return response
                except Exception as error:
                    last_error = error
                    text = str(error)
                    if "thinking" in text.lower() and self.thinking_supported:
                        self.thinking_supported = False
                        continue
                    if "429" in text or "RESOURCE_EXHAUSTED" in text:
                        if attempt == 0:
                            time.sleep(retry_delay_seconds(text))
                            continue
                    break
        self.failures += 1
        if self.failures >= 3:
            self.open_until = time.time() + 60
            self.failures = 0
        raise LLMError(f"All AI models failed: {last_error}")

    def complete(self, prompt: str, system: str = "", cache: bool = False) -> str:
        key = hashlib.sha256((self.models[0] + system + prompt).encode()).hexdigest()
        if cache and key in self.cache:
            return self.cache[key]
        response = self.chat([Message("user", prompt)], system)
        if cache:
            self.cache[key] = response.text
        return response.text


llm = GeminiLLM()
