let csrf: { token: string; headerName: string } | undefined;
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (options.method && options.method !== "GET" && !csrf)
    csrf = await request("/auth/csrf");
  const response = await fetch("/api/v1" + path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { [csrf.headerName]: csrf.token } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ message: "连接暂时失败，请稍后重试" }));
    throw new Error(data.message || `请求失败 (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export function resetCsrf() {
  csrf = undefined;
}
