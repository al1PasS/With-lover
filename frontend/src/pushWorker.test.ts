import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

const source = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
function worker(status: number, state?: { unread: number; enabled: boolean }) {
  type Listener = (event: {
    waitUntil(pending: Promise<unknown>): void;
  }) => void;
  const events = new Map<string, Listener>();
  const showNotification = vi.fn();
  const setAppBadge = vi.fn();
  const clearAppBadge = vi.fn();
  const fetch = vi.fn(async () => ({
    ok: status === 200,
    status,
    json: async () => state,
  }));
  const postMessage = vi.fn();
  runInNewContext(source, {
    fetch,
    self: {
      addEventListener: (name: string, callback: Listener) =>
        events.set(name, callback),
      navigator: { setAppBadge, clearAppBadge },
      registration: { showNotification },
      clients: { matchAll: async () => [{ postMessage }] },
    },
  });
  async function push() {
    let result: Promise<unknown> | undefined;
    events.get("push")?.({
      waitUntil: (value) => {
        result = value;
      },
    });
    await result;
  }
  return {
    fetch,
    showNotification,
    setAppBadge,
    clearAppBadge,
    postMessage,
    push,
  };
}

test("a background ping reads the session count, badges, and shows a generic notification", async () => {
  const sw = worker(200, { enabled: true, unread: 3 });
  await sw.push();
  expect(sw.fetch).toHaveBeenCalledWith("/api/v1/push/status", {
    credentials: "same-origin",
    cache: "no-store",
  });
  expect(sw.setAppBadge).toHaveBeenCalledWith(3);
  expect(sw.showNotification).toHaveBeenCalledWith(
    "拾光有新动态",
    expect.objectContaining({ tag: "shiguang-updates" }),
  );
  expect(sw.postMessage).toHaveBeenCalledWith({ type: "shiguang:push" });
});

test.each([
  [401, undefined],
  [200, { enabled: false, unread: 0 }],
  [200, { enabled: true, unread: 0 }],
] as const)(
  "a delayed push does not show a notification after logout, disable, or marking all read (%i)",
  async (status, state) => {
    const sw = worker(status, state);
    await sw.push();
    expect(sw.showNotification).not.toHaveBeenCalled();
    expect(sw.clearAppBadge).toHaveBeenCalled();
  },
);
