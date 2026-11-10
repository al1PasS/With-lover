import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, resetCsrf } from "./client";

const fetchMock = vi.fn<typeof fetch>();
const events = new EventTarget();
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
beforeEach(() => {
  resetCsrf();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", events);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("API upload and session handling", () => {
  it("leaves multipart boundary to the browser while retaining CSRF and credentials", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ token: "test-token", headerName: "X-CSRF-TOKEN" }),
    );
    fetchMock.mockResolvedValueOnce(json({ revision: 1 }));
    const changed = vi.fn();
    events.addEventListener("shiguang:activity-changed", changed);
    const body = new FormData();
    body.set("file", new Blob(["test"], { type: "audio/wav" }), "song.wav");
    await expect(
      request("/music/tracks", { method: "POST", body }),
    ).resolves.toEqual({ revision: 1 });
    const [url, options] = fetchMock.mock.calls[1];
    const headers = options!.headers as Headers;
    expect(url).toBe("/api/v1/music/tracks");
    expect(options!.body).toBe(body);
    expect(options!.credentials).toBe("same-origin");
    expect(options!.cache).toBe("no-store");
    expect(headers.has("Content-Type")).toBe(false);
    expect(headers.get("X-CSRF-TOKEN")).toBe("test-token");
    expect(changed).toHaveBeenCalledOnce();
    events.removeEventListener("shiguang:activity-changed", changed);
  });
  it("keeps JSON content type and supports Headers instances", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ token: "test-token", headerName: "X-CSRF-TOKEN" }),
    );
    fetchMock.mockResolvedValueOnce(json({}));
    await request("/music/selection", {
      method: "PUT",
      body: JSON.stringify({ trackId: null }),
      headers: new Headers({ "X-Request-ID": "test" }),
    });
    const headers = fetchMock.mock.calls[1][1]!.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Request-ID")).toBe("test");
    expect(headers.get("X-CSRF-TOKEN")).toBe("test-token");
  });
  it("emits auth expired on a 401 snapshot, clears stale CSRF, and throws the server message", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ token: "old", headerName: "X-CSRF-TOKEN" }),
    );
    fetchMock.mockResolvedValueOnce(json({}));
    await request("/music/selection", { method: "PUT" });
    fetchMock.mockResolvedValueOnce(json({ message: "请重新登录" }, 401));
    const expired = vi.fn();
    events.addEventListener("shiguang:auth-expired", expired);
    await expect(request("/music")).rejects.toThrow("请重新登录");
    expect(expired).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(
      json({ token: "new", headerName: "X-CSRF-TOKEN" }),
    );
    fetchMock.mockResolvedValueOnce(json({}));
    await request("/music/selection", { method: "PUT" });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/auth/csrf");
    events.removeEventListener("shiguang:auth-expired", expired);
  });
  it("ignores a stale session 401 after a new login resets CSRF", async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const expired = vi.fn();
    events.addEventListener("shiguang:auth-expired", expired);
    const old = request("/music");
    resetCsrf();
    respond(json({ message: "Old session" }, 401));
    await expect(old).rejects.toThrow("Old session");
    expect(expired).not.toHaveBeenCalled();
    events.removeEventListener("shiguang:auth-expired", expired);
  });
  it("does not mistake an incorrect login password for an expired session", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ token: "test-token", headerName: "X-CSRF-TOKEN" }),
    );
    fetchMock.mockResolvedValueOnce(json({ message: "用户名或密码错误" }, 401));
    const expired = vi.fn();
    events.addEventListener("shiguang:auth-expired", expired);
    await expect(
      request("/auth/login", { method: "POST", body: "{}" }),
    ).rejects.toThrow("用户名或密码错误");
    expect(expired).not.toHaveBeenCalled();
    events.removeEventListener("shiguang:auth-expired", expired);
  });
});
