import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type BrowserContext } from "../frontend/node_modules/@playwright/test/index";
import {
  expectMusicStopped, musicAudio, musicPanel, musicProbe, musicRow, musicToggle,
  observeMusic, selectMusic, startMusicIfBlocked, syntheticWav, uploadMusic,
} from "./music-fixtures";

// Actual API/database/media acceptance, never route-mocked. Requires a disposable
// database seeded ONLY with these test accounts, API on 8080 and VITE_DEMO=false
// on 5174. Do not enable this against an existing user's database.
const baseURL = "http://127.0.0.1:5174";
const api = "/api/v1";
const password = "Music-test-only-2026";

type Snapshot = {
  tracks: { id: string; title: string; contentType: string; byteSize: number; createdAt: string }[];
  selectedTrackId: string | null;
  revision: number;
  limits: { maxFileBytes: number; maxTracks: number; maxTotalBytes: number };
};

async function csrf(request: APIRequestContext) {
  const response = await request.get(`${api}/auth/csrf`);
  expect(response.ok()).toBe(true);
  const token = await response.json() as { token: string; headerName: string };
  return { [token.headerName]: token.token };
}

async function login(context: BrowserContext, username: "music-one" | "music-two") {
  const response = await context.request.post(`${api}/auth/login`, {
    headers: await csrf(context.request), data: { username, password },
  });
  expect(response.status(), "seed synthetic music-one/music-two in the isolated test DB").toBe(200);
  const profile = await context.request.get(`${api}/account/profile`);
  expect(profile.ok()).toBe(true);
  expect((await profile.json()).username).toBe(username);
}

async function snapshot(request: APIRequestContext) {
  const response = await request.get(`${api}/music`);
  expect(response.ok()).toBe(true);
  return await response.json() as Snapshot;
}

test.describe("real-stack private shared music", () => {
  test.skip(process.env.MUSIC_REAL_TEST !== "true", "requires isolated real stack and MUSIC_REAL_TEST=true");
  test.use({ baseURL });

  test("two independent members persist selection, keep local off during remote changes, and protect ranged audio", async ({ browser }) => {
    test.setTimeout(90_000);
    const memberA = await browser.newContext({ baseURL });
    const memberB = await browser.newContext({ baseURL });
    const anonymous = await browser.newContext({ baseURL });
    const created = new Set<string>();
    let initialSelection: string | null = null;
    let baselineLoaded = false;
    let memberBLoggedIn = false;
    const prefix = `music-e2e-${randomUUID()}`;
    const firstTitle = `${prefix}-one`;
    const secondTitle = `${prefix}-two`;
    const firstWav = syntheticWav(`${prefix}-one.wav`);
    const secondWav = syntheticWav(`${prefix}-two.wav`, 330);
    try {
      await login(memberA, "music-one");
      const baseline = await snapshot(memberA.request);
      initialSelection = baseline.selectedTrackId;
      baselineLoaded = true;
      expect(baseline.limits).toMatchObject({ maxFileBytes: 20 * 1024 * 1024, maxTracks: 20, maxTotalBytes: 200 * 1024 * 1024 });
      // Enough headroom for this test; never delete somebody else's tracks to make space.
      expect(baseline.tracks.length).toBeLessThanOrEqual(baseline.limits.maxTracks - 2);
      const pageA = await memberA.newPage();
      const pageB = await memberB.newPage();
      await observeMusic(pageA);
      await observeMusic(pageB);
      await pageA.goto("/admin");
      await expect(musicPanel(pageA)).toBeVisible();
      await uploadMusic(pageA, firstTitle, firstWav);
      let current = await snapshot(memberA.request);
      const firstTrack = current.tracks.find(track => track.title === firstTitle)!;
      expect(firstTrack).toBeDefined();
      created.add(firstTrack.id);
      expect(firstTrack.byteSize).toBe(firstWav.buffer.length);
      expect(firstTrack.contentType).toBe("audio/wav");
      expect(Number.isNaN(Date.parse(firstTrack.createdAt))).toBe(false);
      expect(current.selectedTrackId).toBe(initialSelection); // Upload is not selection.
      expect(current.revision).toBeGreaterThan(baseline.revision);
      await selectMusic(pageA, firstTitle);
      await startMusicIfBlocked(pageA);
      current = await snapshot(memberA.request);
      expect(current.selectedTrackId).toBe(firstTrack.id);

      // A second independently authenticated member sees the persisted selection on login/load.
      await login(memberB, "music-two");
      memberBLoggedIn = true;
      await pageB.goto("/admin");
      await expect(musicRow(pageB, firstTitle).getByText("当前背景音乐", { exact: true })).toBeVisible();
      await startMusicIfBlocked(pageB);
      await pageA.bringToFront();
      await musicToggle(pageA).click();
      await expect(musicToggle(pageA)).toHaveAttribute("data-state", "off");
      await expectMusicStopped(pageA);
      const mutedProbe = await musicProbe(pageA);

      // The ordinary member can upload/select too. A focus refresh is a real supported
      // synchronization trigger, not an API mock or a modification of provider state.
      await pageB.bringToFront();
      await uploadMusic(pageB, secondTitle, secondWav);
      current = await snapshot(memberB.request);
      const secondTrack = current.tracks.find(track => track.title === secondTitle)!;
      expect(secondTrack).toBeDefined();
      created.add(secondTrack.id);
      expect(current.selectedTrackId).toBe(firstTrack.id);
      await selectMusic(pageB, secondTitle);
      await startMusicIfBlocked(pageB);
      await pageA.bringToFront();
      await pageA.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(musicRow(pageA, secondTitle).getByText("当前背景音乐", { exact: true })).toBeVisible({ timeout: 22_000 });
      await expect(musicToggle(pageA)).toHaveAttribute("data-state", "off");
      await expectMusicStopped(pageA);
      expect((await musicProbe(pageA)).playCalls).toBe(mutedProbe.playCalls);
      const persisted = await snapshot(memberA.request);
      expect(persisted.selectedTrackId).toBe(secondTrack.id);
      expect(persisted.revision).toBeGreaterThan(baseline.revision);
      await pageA.reload();
      await expect(musicRow(pageA, secondTitle).getByText("当前背景音乐", { exact: true })).toBeVisible();
      await startMusicIfBlocked(pageA);
      await expect(musicAudio(pageA)).toHaveAttribute("src", new RegExp(`/music/tracks/${secondTrack.id}/content$`));
      expect(await musicAudio(pageA).evaluate((element: HTMLAudioElement) => new URL(element.currentSrc).origin)).toBe(new URL(baseURL).origin);

      const content = `${api}/music/tracks/${secondTrack.id}/content`;
      const ranged = await memberB.request.get(content, { headers: { Range: "bytes=0-43" } });
      expect(ranged.status()).toBe(206);
      expect(ranged.headers()["content-range"]).toBe(`bytes 0-43/${secondWav.buffer.length}`);
      expect(ranged.headers()["accept-ranges"]).toBe("bytes");
      expect(ranged.headers()["content-type"]).toMatch(/^audio\/wav(?:;|$)/);
      expect(ranged.headers()["x-content-type-options"]).toBe("nosniff");
      expect(ranged.headers()["cache-control"]).toContain("private");
      expect(ranged.headers()["cache-control"]).toContain("no-store");
      expect(ranged.headers()["content-disposition"]).toBeTruthy();
      expect(await ranged.body()).toEqual(secondWav.buffer.subarray(0, 44));
      const head = await memberB.request.head(content);
      expect(head.status()).toBe(200);
      expect(Number(head.headers()["content-length"])).toBe(secondWav.buffer.length);
      expect(await head.body()).toHaveLength(0);
      const unsatisfiable = await memberB.request.get(content, { headers: { Range: `bytes=${secondWav.buffer.length}-` } });
      expect(unsatisfiable.status()).toBe(416);
      expect(unsatisfiable.headers()["content-range"]).toBe(`bytes */${secondWav.buffer.length}`);
      for (const path of [`${api}/music`, content]) {
        const denied = await anonymous.request.get(path, { headers: { Range: "bytes=0-43" }, maxRedirects: 0 });
        expect(denied.status()).toBe(401);
      }
      const noCsrf = await memberB.request.put(`${api}/music/selection`, { data: { trackId: firstTrack.id } });
      expect(noCsrf.status()).toBe(403);
      expect((await snapshot(memberB.request)).selectedTrackId).toBe(secondTrack.id);

      // Logout really revokes this context's content access, including Range reads.
      const audio = await musicAudio(pageA).elementHandle();
      await pageA.getByRole("button", { name: "退出登录", exact: true }).click();
      await expect(musicToggle(pageA)).toHaveCount(0);
      await expect.poll(() => audio!.evaluate((element: HTMLAudioElement) => element.paused && !element.getAttribute("src"))).toBe(true);
      const afterLogout = await memberA.request.get(content, { headers: { Range: "bytes=0-43" }, maxRedirects: 0 });
      expect(afterLogout.status()).toBe(401);
      // Logging back in proves selection is server data, not prior page/provider state.
      await login(memberA, "music-one");
      await pageA.goto("/admin");
      await expect(musicRow(pageA, secondTitle).getByText("当前背景音乐", { exact: true })).toBeVisible();
      await startMusicIfBlocked(pageA);

      // A deletes B's selected track; neither member silently falls back to track one.
      await musicRow(pageA, secondTitle).getByRole("button", { name: `删除音乐：${secondTitle}`, exact: true }).click();
      await pageA.getByRole("dialog", { name: "删除这首音乐？", exact: true }).getByRole("button", { name: "确认删除", exact: true }).click();
      await expect(musicRow(pageA, secondTitle)).toHaveCount(0);
      await expect(musicToggle(pageA)).toHaveAttribute("data-state", "empty");
      await expectMusicStopped(pageA);
      await pageB.bringToFront();
      await pageB.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(musicToggle(pageB)).toHaveAttribute("data-state", "empty", { timeout: 22_000 });
      await expectMusicStopped(pageB);
      expect((await snapshot(memberB.request)).selectedTrackId).toBeNull();
      const deleted = await memberB.request.get(content);
      expect(deleted.status()).toBe(404);
    } finally {
      // Only names created by this run may be removed, even after a partial upload
      // failure. Never reset the DB, accounts, or an unrelated library item.
      try {
        if (baselineLoaded) {
          if (!memberBLoggedIn) await login(memberB, "music-two");
          const current = await snapshot(memberB.request);
          for (const track of current.tracks) {
            if (track.title === firstTitle || track.title === secondTitle) created.add(track.id);
          }
          const restoreSelection = current.selectedTrackId === null || created.has(current.selectedTrackId);
          for (const id of created) {
            const response = await memberB.request.delete(`${api}/music/tracks/${id}`, { headers: await csrf(memberB.request) });
            expect([200, 204, 404]).toContain(response.status());
          }
          if (restoreSelection && initialSelection && (await snapshot(memberB.request)).tracks.some(track => track.id === initialSelection)) {
            const response = await memberB.request.put(`${api}/music/selection`, {
              headers: await csrf(memberB.request), data: { trackId: initialSelection },
            });
            expect(response.ok()).toBe(true);
          }
        }
      } finally {
        await Promise.all([memberA.close(), memberB.close(), anonymous.close()]);
      }
    }
  });
});
