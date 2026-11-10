export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrf: { token: string; headerName: string } | undefined;
let sessionGeneration = 0;
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (options.method && options.method !== "GET" && !csrf)
    csrf = await request("/auth/csrf");
  const generation = sessionGeneration;
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (csrf) headers.set(csrf.headerName, csrf.token);
  const response = await fetch("/api/v1" + path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    // Incorrect login credentials are not an expired signed-in session.
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      generation === sessionGeneration
    ) {
      resetCsrf();
      window.dispatchEvent(new Event("shiguang:auth-expired"));
    }
    const data = await response
      .json()
      .catch(() => ({ message: "连接暂时失败，请稍后重试" }));
    throw new ApiError(
      data.message || `请求失败 (${response.status})`,
      response.status,
    );
  }
  if (
    options.method &&
    options.method !== "GET" &&
    !path.startsWith("/activities") &&
    !path.startsWith("/auth")
  )
    window.dispatchEvent(new Event("shiguang:activity-changed"));
  if (response.status === 204) return undefined as T;
  return response.json();
}
export function resetCsrf() {
  ++sessionGeneration;
  csrf = undefined;
}
