export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 500) }; }
  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export interface FileNode { name: string; path: string; type: 'file' | 'dir'; children?: FileNode[]; gitStatus?: string }
export interface Inspection { root: string; name: string; framework: string; packageManager: string; scripts: Record<string, string>; isGit: boolean; hasDevScript: boolean; entryFiles: string[] }
