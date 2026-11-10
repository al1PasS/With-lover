import {
  test,
  expect,
  type Page,
  type Route,
} from "../frontend/node_modules/@playwright/test/index";
import {
  expectMusicStopped,
  expectNativePlaying,
  musicAudio,
  musicPanel,
  musicProbe,
  musicRow,
  musicToggle,
  observeMusic,
  startMusicIfBlocked,
  syntheticWav,
} from "./music-fixtures";

// Browser-only acceptance: a dedicated VITE_DEMO=false server, synthetic API
// responses and generated PCM. No existing backend, accounts, or media are used.
test.skip(
  process.env.MUSIC_PUBLIC_UI_TEST !== "true",
  "requires real-mode Vite on 5174",
);
test.use({ baseURL: "http://127.0.0.1:5174" });

const api = "/api/v1";
const firstId = "public-music-one";
const secondId = "public-music-two";
const tracks = [firstId, secondId].map((id, index) => ({
  id,
  title: `仅登录曲库标题${index + 1}`,
  contentType: "audio/wav",
  byteSize: syntheticWav().buffer.length,
  createdAt: "2026-11-10T08:00:00Z",
}));
const limits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxTracks: 20,
  maxTotalBytes: 200 * 1024 * 1024,
};
type Selection = { selectedTrackId: string | null; revision: number };
type Reply = { status?: number; json?: unknown };
type RequestEntry = { path: string; method: string; signedIn: boolean };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function mockMusic(
  page: Page,
  options: {
    signedIn?: boolean;
    selectedTrackId?: string | null;
    mode?: "SELECTED" | "PRIVATE";
    holdIdentity?: boolean;
  } = {},
) {
  const state = {
    signedIn: options.signedIn ?? false,
    mode: options.mode ?? ("SELECTED" as "SELECTED" | "PRIVATE"),
    selection: {
      selectedTrackId:
        options.selectedTrackId === undefined
          ? firstId
          : options.selectedTrackId,
      revision: 7,
    } as Selection,
    publicStatus: 200,
    contentStatus: 200,
    requests: [] as RequestEntry[],
    unexpected: [] as string[],
  };
  const identity = deferred();
  if (!options.holdIdentity) identity.release();
  const pending = new Map<
    string,
    {
      entered: ReturnType<typeof deferred>;
      gate: ReturnType<typeof deferred>;
      reply: Reply;
    }[]
  >();
  function holdNext(path: string, reply: Reply) {
    const hold = { entered: deferred(), gate: deferred(), reply };
    pending.set(path, [...(pending.get(path) || []), hold]);
    return { started: hold.entered.promise, release: hold.gate.release };
  }
  const reply = async (route: Route, response: Reply) => {
    await route.fulfill({
      status: response.status ?? 200,
      json: response.json ?? { message: "合成访问被拒绝" },
      headers: { "Cache-Control": "private, no-store" },
    });
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(api.length);
    const method = request.method();
    state.requests.push({ path, method, signedIn: state.signedIn });
    const hold = pending.get(path)?.shift();
    if (hold) {
      hold.entered.release();
      await hold.gate.promise;
      await reply(route, hold.reply);
      return;
    }
    if (path === "/auth/me") {
      await identity.promise;
      return reply(route, {
        json: state.signedIn
          ? { name: "合成音乐成员", role: "ADMIN" }
          : { name: null, role: null },
      });
    }
    if (path === "/auth/csrf")
      return reply(route, {
        json: { token: "music-mock-csrf", headerName: "X-CSRF-TOKEN" },
      });
    if (path === "/auth/login") {
      state.signedIn = true;
      return reply(route, { json: { name: "合成音乐成员", role: "ADMIN" } });
    }
    if (path === "/auth/logout") {
      state.signedIn = false;
      return reply(route, { json: {} });
    }
    if (path === "/public/privacy" || path === "/admin/privacy") {
      return reply(route, {
        json: {
          mode: state.mode,
          home: false,
          timeline: true,
          anniversaries: false,
          albums: false,
          places: false,
        },
      });
    }
    if (path === "/public/music") {
      if (state.mode === "PRIVATE" || state.publicStatus !== 200)
        return reply(route, {
          status: state.mode === "PRIVATE" ? 403 : state.publicStatus,
        });
      // Deliberately no library, title, filename, limits, or private media URL.
      return reply(route, { json: { ...state.selection } });
    }
    if (path === "/music") {
      return reply(
        route,
        state.signedIn
          ? { json: { tracks, ...state.selection, limits } }
          : { status: 401 },
      );
    }
    const content = path.match(
      /^\/(public\/)?music\/tracks\/([^/]+)\/content$/,
    );
    if (content) {
      const isPublic = Boolean(content[1]);
      const id = content[2];
      if (!isPublic && !state.signedIn) return reply(route, { status: 401 });
      if (isPublic && state.mode === "PRIVATE")
        return reply(route, { status: 403 });
      if (isPublic && id !== state.selection.selectedTrackId)
        return reply(route, { status: 404 });
      if (isPublic && state.contentStatus !== 200)
        return reply(route, { status: state.contentStatus });
      const wav = syntheticWav(`${id}.wav`, id === firstId ? 220 : 330).buffer;
      const range = request.headers()["range"]?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2]
        ? Math.min(Number(range[2]), wav.length - 1)
        : wav.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: "audio/wav",
        body: wav.subarray(start, end + 1),
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          ...(range
            ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` }
            : {}),
        },
      });
    }
    if (path === "/account/profile")
      return reply(route, {
        json: {
          id: 1,
          username: "music-mock",
          nickname: "合成音乐成员",
          role: "ADMIN",
        },
      });
    if (path === "/activities")
      return reply(route, {
        json: { items: [], unread: 0, latestId: 0, nextCursor: null },
      });
    if (
      [
        "/memories",
        "/public/memories",
        "/trash",
        "/anniversaries",
        "/places",
      ].includes(path)
    )
      return reply(route, { json: [] });
    if (path === "/media/cover")
      return route.fulfill({
        status: 302,
        headers: { location: "/images/cover.webp" },
      });
    state.unexpected.push(`${method} ${path}`);
    return reply(route, { status: 404 });
  });
  return { state, holdNext, releaseIdentity: identity.release };
}

async function focusRefresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function clearedSource(page: Page) {
  await expectMusicStopped(page);
  await expect.poll(() => musicAudio(page).getAttribute("src")).toBeNull();
  await expect(musicToggle(page)).toBeVisible();
  await expect(musicToggle(page)).toBeDisabled();
}
async function loginThroughUI(page: Page) {
  await page
    .getByRole("button", { name: "进入我们的小世界", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "回到我们的小世界",
    exact: true,
  });
  await dialog.getByLabel("账户", { exact: true }).fill("music-mock");
  await dialog
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-test-only-2026");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: "管理我们的空间", exact: true }).click();
  await expect(musicPanel(page)).toBeVisible();
}
async function finishHeldResponse(
  page: Page,
  path: string,
  release: () => void,
) {
  const received = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${api}${path}`,
  );
  release();
  await (await received).finished();
  // Let the fetch continuation and React commit run before the negative assertion.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test("identity readiness gates public music; guest empty control stays visible, disabled and never routes to admin", async ({
  page,
}) => {
  await observeMusic(page);
  const mock = await mockMusic(page, {
    selectedTrackId: null,
    holdIdentity: true,
  });
  await page.goto("/");
  await expect(musicToggle(page)).toBeVisible();
  await expect(musicToggle(page)).toBeDisabled();
  expect(
    mock.state.requests.filter((entry) => entry.path.includes("music")),
  ).toEqual([]);
  mock.releaseIdentity();
  await expect
    .poll(
      () =>
        mock.state.requests.filter((entry) => entry.path === "/public/music")
          .length,
    )
    .toBeGreaterThan(0);
  await clearedSource(page);
  await expect(musicToggle(page)).toHaveAccessibleName(
    "背景音乐：暂无可播放的歌曲",
  );
  // Native disabled click has no navigation side effect, even when dispatched directly.
  await musicToggle(page).evaluate((button: HTMLButtonElement) =>
    button.click(),
  );
  await expect(page).toHaveURL("http://127.0.0.1:5174/");
  await expect(musicPanel(page)).toHaveCount(0);
  await expect(page.getByLabel("选择音乐文件", { exact: true })).toHaveCount(0);
  expect((await musicProbe(page)).playCalls).toBe(0);
  expect(mock.state.requests.some((entry) => entry.path === "/music")).toBe(
    false,
  );
  expect(mock.state.unexpected).toEqual([]);
});

test("SELECTED guest plays actual public WAV after blocked click, has no library, and keeps one audio across SPA routes", async ({
  page,
}) => {
  await observeMusic(page, true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const mock = await mockMusic(page);
  await page.goto("/");
  await expect(musicToggle(page)).toBeVisible();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "blocked");
  await expect(musicToggle(page)).not.toHaveClass(/is-playing/);
  await expectMusicStopped(page);
  expect((await musicProbe(page)).denied).toBe(1);
  expect((await musicProbe(page)).events.playing || 0).toBe(0);
  await musicToggle(page).click();
  await expectNativePlaying(page);
  await expect(musicAudio(page)).toHaveAttribute(
    "src",
    `${api}/public/music/tracks/${firstId}/content`,
  );
  await expect(musicToggle(page)).toHaveClass(/is-playing/);
  await expect(musicToggle(page).locator(".music-note")).toHaveCSS(
    "animation-name",
    "music-note-turn",
  );
  await expect(musicPanel(page)).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "音乐曲库", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("选择音乐文件", { exact: true })).toHaveCount(0);
  await expect(page.getByText(tracks[0].title, { exact: true })).toHaveCount(0);
  const audio = await musicAudio(page).elementHandle();
  const before = await musicProbe(page);
  const time = await musicAudio(page).evaluate(
    (element: HTMLAudioElement) => element.currentTime,
  );
  await page
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("link", { name: "时光", exact: true })
    .click();
  await expect(page).toHaveURL(/\/timeline$/);
  await expectNativePlaying(page);
  expect(
    await audio!.evaluate(
      (element) =>
        element.isConnected &&
        element === document.querySelector('[data-testid="background-audio"]'),
    ),
  ).toBe(true);
  expect(
    await musicAudio(page).evaluate(
      (element: HTMLAudioElement) => element.currentTime,
    ),
  ).toBeGreaterThanOrEqual(time);
  expect((await musicProbe(page)).playCalls).toBe(before.playCalls);
  expect((await musicProbe(page)).events.pause || 0).toBe(
    before.events.pause || 0,
  );
  expect(
    mock.state.requests.filter((entry) => entry.path.startsWith("/music")),
  ).toEqual([]);
  expect(
    mock.state.requests.some(
      (entry) => entry.path === `/public/music/tracks/${firstId}/content`,
    ),
  ).toBe(true);
  expect(mock.state.unexpected).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("music-guest-playing.png"),
    animations: "disabled",
  });
});

test("focus swaps public selection without enabling local off; clearing selection removes the source", async ({
  page,
}) => {
  await observeMusic(page);
  const mock = await mockMusic(page);
  await page.goto("/");
  await startMusicIfBlocked(page);
  await musicToggle(page).click();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  const before = await musicProbe(page);
  mock.state.selection = { selectedTrackId: secondId, revision: 8 };
  await focusRefresh(page);
  await expect(musicAudio(page)).toHaveAttribute(
    "src",
    `${api}/public/music/tracks/${secondId}/content`,
  );
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  await expectMusicStopped(page);
  expect((await musicProbe(page)).playCalls).toBe(before.playCalls);
  await musicToggle(page).click();
  await expectNativePlaying(page);
  mock.state.selection = { selectedTrackId: null, revision: 9 };
  await focusRefresh(page);
  await clearedSource(page);
  expect(mock.state.unexpected).toEqual([]);
});

for (const status of [403, 404]) {
  test(`public ${status} revokes a playing source and the same revision can recover`, async ({
    page,
  }) => {
    await observeMusic(page);
    const mock = await mockMusic(page);
    await page.goto("/");
    await startMusicIfBlocked(page);
    mock.state.publicStatus = status;
    await focusRefresh(page);
    await clearedSource(page);
    mock.state.publicStatus = 200; // Selection/revision deliberately unchanged.
    await focusRefresh(page);
    await expect(musicAudio(page)).toHaveAttribute(
      "src",
      `${api}/public/music/tracks/${firstId}/content`,
    );
    await startMusicIfBlocked(page);
    expect(mock.state.selection.revision).toBe(7);
    expect(mock.state.unexpected).toEqual([]);
  });
}

test("PRIVATE remains 403 while guest private library and content remain 401; SELECTED restores the same revision", async ({
  page,
}) => {
  await observeMusic(page);
  const mock = await mockMusic(page, { mode: "PRIVATE" });
  await page.goto("/");
  await expect
    .poll(() =>
      mock.state.requests.some((entry) => entry.path === "/public/music"),
    )
    .toBe(true);
  await clearedSource(page);
  const denied = await page.evaluate(
    async ({ api, firstId }) =>
      Promise.all(
        [
          `${api}/public/music`,
          `${api}/public/music/tracks/${firstId}/content`,
          `${api}/music`,
          `${api}/music/tracks/${firstId}/content`,
        ].map(
          async (path) =>
            (await fetch(path, { headers: { Range: "bytes=0-43" } })).status,
        ),
      ),
    { api, firstId },
  );
  expect(denied).toEqual([403, 403, 401, 401]);
  expect((await musicProbe(page)).playCalls).toBe(0);
  mock.state.mode = "SELECTED";
  await focusRefresh(page);
  await startMusicIfBlocked(page);
  expect(mock.state.selection.revision).toBe(7);
  expect(mock.state.unexpected).toEqual([]);
});

test("native public stream denial refreshes permission and clears the inaccessible source", async ({
  page,
}) => {
  await observeMusic(page);
  const mock = await mockMusic(page);
  await page.goto("/");
  await startMusicIfBlocked(page);
  mock.state.selection = { selectedTrackId: secondId, revision: 8 };
  const deniedContent = mock.holdNext(
    `/public/music/tracks/${secondId}/content`,
    { status: 403 },
  );
  await focusRefresh(page);
  await deniedContent.started;
  // Reject metadata before releasing the failed stream, so its native media
  // error deterministically observes the revoked policy when it rechecks access.
  mock.state.publicStatus = 403;
  deniedContent.release();
  await expect
    .poll(async () => (await musicProbe(page)).events.error || 0)
    .toBeGreaterThan(0);
  await clearedSource(page);
  mock.state.publicStatus = 200;
  mock.state.contentStatus = 200;
  await focusRefresh(page);
  await startMusicIfBlocked(page);
  await expect(musicAudio(page)).toHaveAttribute(
    "src",
    `${api}/public/music/tracks/${secondId}/content`,
  );
  expect(mock.state.unexpected).toEqual([]);
});

test("visible guest checks the public selection every fifteen seconds without focus", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await observeMusic(page);
  const mock = await mockMusic(page, { selectedTrackId: null });
  await page.goto("/");
  await clearedSource(page);
  await expect
    .poll(
      () =>
        mock.state.requests.filter((entry) => entry.path === "/public/music")
          .length,
    )
    .toBeGreaterThan(0);
  const requestsBefore = mock.state.requests.filter(
    (entry) => entry.path === "/public/music",
  ).length;
  mock.state.selection = { selectedTrackId: firstId, revision: 8 };
  await expect(musicAudio(page)).toHaveAttribute(
    "src",
    `${api}/public/music/tracks/${firstId}/content`,
    { timeout: 20_000 },
  );
  await startMusicIfBlocked(page);
  expect(
    mock.state.requests.filter((entry) => entry.path === "/public/music")
      .length,
  ).toBeGreaterThan(requestsBefore);
  expect(mock.state.unexpected).toEqual([]);
});

for (const status of [200, 403, 404]) {
  test(`late guest ${status} cannot overwrite the logged-in management snapshot`, async ({
    page,
  }) => {
    await observeMusic(page);
    const mock = await mockMusic(page);
    await page.goto("/");
    await startMusicIfBlocked(page);
    const held = mock.holdNext("/public/music", {
      status,
      json: { selectedTrackId: secondId, revision: 99_999 },
    });
    await focusRefresh(page);
    await held.started;
    await loginThroughUI(page);
    await expect(
      musicRow(page, tracks[0].title).getByText("当前背景音乐", {
        exact: true,
      }),
    ).toBeVisible();
    await startMusicIfBlocked(page);
    await finishHeldResponse(page, "/public/music", held.release);
    await expect(musicPanel(page).getByRole("listitem")).toHaveCount(2);
    await expect(
      musicRow(page, tracks[0].title).getByText("当前背景音乐", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(musicAudio(page)).toHaveAttribute(
      "src",
      `${api}/music/tracks/${firstId}/content`,
    );
    await expectNativePlaying(page);
    expect(mock.state.unexpected).toEqual([]);
  });
}

test("logout reloads public source; late private and earlier guest snapshots cannot replace it or restore the library", async ({
  page,
}) => {
  await observeMusic(page);
  const mock = await mockMusic(page);
  await page.goto("/");
  await startMusicIfBlocked(page);
  const staleGuest = mock.holdNext("/public/music", {
    json: { selectedTrackId: secondId, revision: 99_999 },
  });
  await focusRefresh(page);
  await staleGuest.started;
  await loginThroughUI(page);
  await startMusicIfBlocked(page);
  const audio = await musicAudio(page).elementHandle();
  const stalePrivate = mock.holdNext("/music", {
    json: { tracks, selectedTrackId: secondId, revision: 100_000, limits },
  });
  await focusRefresh(page);
  await stalePrivate.started;
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(musicPanel(page)).toHaveCount(0);
  await expect(musicAudio(page)).toHaveAttribute(
    "src",
    `${api}/public/music/tracks/${firstId}/content`,
  );
  await startMusicIfBlocked(page);
  await finishHeldResponse(page, "/music", stalePrivate.release);
  await finishHeldResponse(page, "/public/music", staleGuest.release);
  await expect(musicAudio(page)).toHaveAttribute(
    "src",
    `${api}/public/music/tracks/${firstId}/content`,
  );
  await expectNativePlaying(page);
  expect(
    await audio!.evaluate(
      (element) =>
        element.isConnected &&
        element === document.querySelector('[data-testid="background-audio"]'),
    ),
  ).toBe(true);
  await expect(musicPanel(page)).toHaveCount(0);
  await expect(page.getByLabel("选择音乐文件", { exact: true })).toHaveCount(0);
  const privateStatuses = await page.evaluate(
    async ({ api, firstId }) =>
      Promise.all(
        [`${api}/music`, `${api}/music/tracks/${firstId}/content`].map(
          async (path) => (await fetch(path)).status,
        ),
      ),
    { api, firstId },
  );
  expect(privateStatuses).toEqual([401, 401]);
  expect(
    mock.state.requests.some(
      (entry) => entry.path === "/public/music" && !entry.signedIn,
    ),
  ).toBe(true);
  expect(mock.state.unexpected).toEqual([]);
});

for (const status of [403, 404]) {
  test(`earlier public ${status} cannot revoke a newer successful focus refresh`, async ({
    page,
  }) => {
    await observeMusic(page);
    const mock = await mockMusic(page);
    await page.goto("/");
    await startMusicIfBlocked(page);
    const stale = mock.holdNext("/public/music", { status });
    await focusRefresh(page);
    await stale.started;
    mock.state.selection = { selectedTrackId: secondId, revision: 8 };
    await focusRefresh(page);
    await expect(musicAudio(page)).toHaveAttribute(
      "src",
      `${api}/public/music/tracks/${secondId}/content`,
    );
    await startMusicIfBlocked(page);
    await finishHeldResponse(page, "/public/music", stale.release);
    await expect(musicAudio(page)).toHaveAttribute(
      "src",
      `${api}/public/music/tracks/${secondId}/content`,
    );
    await expectNativePlaying(page);
    expect(mock.state.unexpected).toEqual([]);
  });
}

test("375px dark reduced-motion guest control is visible, bounded, playable and has no management UI", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await observeMusic(page, true);
  const mock = await mockMusic(page);
  await page.goto("/");
  await startMusicIfBlocked(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(musicToggle(page).locator(".music-note")).toHaveCSS(
    "animation-name",
    "none",
  );
  const bounds = await musicToggle(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(musicPanel(page)).toHaveCount(0);
  await musicToggle(page).click();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  await expect(musicToggle(page).locator(".music-slash")).toBeVisible();
  await expectMusicStopped(page);
  await musicToggle(page).click();
  await startMusicIfBlocked(page);
  await page.screenshot({
    path: test.info().outputPath("music-guest-mobile-dark.png"),
    animations: "disabled",
  });
  expect(mock.state.unexpected).toEqual([]);
});
