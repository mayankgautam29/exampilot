export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "exampilot.token";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

type Params = Record<string, string | number | undefined | null>;

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Params;
  headers?: Record<string, string>;
}

function buildUrl(path: string, params?: Params): string {
  const url = new URL(path, API_URL);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function describe(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  return fallback;
}

async function failure(response: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    detail = (await response.json()).detail;
  } catch {}
  if (response.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    setToken(null);
    window.location.href = "/login";
  }
  return new ApiError(response.status, describe(detail, response.statusText), detail);
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.params), {
    method: options.method ?? "GET",
    headers: authHeaders({ ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...options.headers }),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function streamEvents<T>(path: string, options: RequestOptions, onEvent: (event: T) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(buildUrl(path, options.params), {
    method: options.method ?? "GET",
    headers: authHeaders(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal,
  });
  if (!response.ok || !response.body) throw await failure(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as T);
    }
  }
}

export async function download(path: string, fallbackName: string, params?: Params): Promise<void> {
  const response = await fetch(buildUrl(path, params), { headers: authHeaders() });
  if (!response.ok) throw await failure(response);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
