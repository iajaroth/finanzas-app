const TOKEN_KEY = 'fin_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Para la app Android (Capacitor) se define VITE_API_BASE al compilar;
// en web se usa la misma origen.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401 && getToken()) {
    clearToken();
    window.location.hash = '';
    window.location.href = '/login';
    throw new ApiError('Sesión expirada', 401);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Error ${res.status}`, res.status);
  return data as T;
}

export const api = {
  get: <T,>(p: string) => request<T>(p),
  post: <T,>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T,>(p: string, body?: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T,>(p: string, body?: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  del: <T,>(p: string) => request<T>(p, { method: 'DELETE' }),
};
