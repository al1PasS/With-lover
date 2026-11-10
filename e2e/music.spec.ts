import { Buffer } from "node:buffer";
import { test, expect, type Page } from "../frontend/node_modules/@playwright/test/index";
import {
  confirmDeleteMusic, expectMusicStopped, expectNativePlaying, musicAudio,
  musicPanel, musicProbe, musicRow, musicToggle, observeMusic, selectMusic,
  startMusicIfBlocked, syntheticWav, uploadMusic,
} from "./music-fixtures";

// Demo/browser acceptance only. Real persistence, authentication and cross-context
// synchronization are deliberately covered separately in music-real.spec.ts.
async function enterDemo(page: Page) {
  await page.goto("/");
  await expect(musicToggle(page)).toBeVisible();
  await expect(musicToggle(page)).toBeDisabled();
  await page.getByRole("button", { name: "进入我们的小世界", exact: true }).click();
  await page.getByRole("button", { name: "进入示例空间", exact: true }).click();
  await page.getByRole("link", { name: "管理我们的空间", exact: true }).click();
  await expect(musicPanel(page)).toBeVisible();
}

test("demo music uploads explicitly, validates errors, and deletes to an empty library", async ({ page }) => {
  await observeMusic(page);
  await enterDemo(page);
  await expect(musicToggle(page)).toHaveAttribute("data-state", "empty");
  await expect(musicPanel(page)).toContainText(/刷新.*清空/);
  await musicPanel(page).getByLabel("选择音乐文件", { exact: true }).setInputFiles({
    name: "not-audio.txt", mimeType: "text/plain", buffer: Buffer.from("not an audio file"),
  });
  await musicPanel(page).getByRole("button", { name: "上传音乐", exact: true }).click();
  await expect(musicPanel(page).getByRole("alert")).toContainText(/MP3|WAV|格式|音频/);
  await expect(musicPanel(page).getByRole("listitem")).toHaveCount(0);

  await uploadMusic(page, "合成曲目甲");
  await expect(musicRow(page, "合成曲目甲").getByText("当前背景音乐", { exact: true })).toHaveCount(0);
  await expect(musicToggle(page)).toHaveAttribute("data-state", "empty");
  expect((await musicProbe(page)).playCalls).toBe(0);
  await selectMusic(page, "合成曲目甲");
  await startMusicIfBlocked(page);
  const source = await musicAudio(page).getAttribute("src");
  await uploadMusic(page, "合成曲目乙", syntheticWav("second.wav", 330));
  await expect(musicRow(page, "合成曲目甲").getByText("当前背景音乐", { exact: true })).toBeVisible();
  await expect(musicAudio(page)).toHaveAttribute("src", source!);
  await expect(page.locator(".toast")).toBeHidden();
  await musicPanel(page).screenshot({ path: test.info().outputPath("music-desktop.png"), animations: "disabled" });
  await test.info().attach("music-desktop", { path: test.info().outputPath("music-desktop.png"), contentType: "image/png" });

  await musicRow(page, "合成曲目甲").getByRole("button", { name: "删除音乐：合成曲目甲", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "删除这首音乐？", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(musicRow(page, "合成曲目甲")).toBeVisible();
  await expectNativePlaying(page);
  await confirmDeleteMusic(page, "合成曲目甲");
  await expect(musicToggle(page)).toHaveAttribute("data-state", "empty");
  await expectMusicStopped(page);
  await expect.poll(() => musicAudio(page).evaluate((audio: HTMLAudioElement) => audio.getAttribute("src") || "")).toBe("");
  await expect(musicRow(page, "合成曲目乙").getByText("当前背景音乐", { exact: true })).toHaveCount(0);
  await confirmDeleteMusic(page, "合成曲目乙");
  await expect(musicPanel(page).getByRole("listitem")).toHaveCount(0);
  await expect(musicPanel(page)).toContainText(/还没有|暂无|上传/);
});

test("native audio events drive the icon and SPA navigation does not recreate or restart music", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await observeMusic(page);
  await enterDemo(page);
  await uploadMusic(page, "路由连续播放");
  await selectMusic(page, "路由连续播放");
  await startMusicIfBlocked(page);
  await expect(musicToggle(page)).toHaveClass(/is-playing/);
  await expect(musicToggle(page).locator(".music-note")).toHaveCSS("animation-name", "music-note-turn");
  await expect(musicToggle(page).locator(".music-slash")).toHaveCount(0);
  const audio = await musicAudio(page).elementHandle();
  const before = await musicProbe(page);
  const source = await musicAudio(page).getAttribute("src");
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "时光", exact: true }).click();
  await expect(page).toHaveURL(/\/timeline$/);
  await page.getByRole("link", { name: "管理我们的空间", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect(await audio!.evaluate(node => node.isConnected && node === document.querySelector('[data-testid="background-audio"]'))).toBe(true);
  await expect(musicAudio(page)).toHaveAttribute("src", source!);
  await expectNativePlaying(page);
  const after = await musicProbe(page);
  expect(after.playCalls).toBe(before.playCalls);
  expect(after.events.pause || 0).toBe(before.events.pause || 0);

  await musicAudio(page).evaluate((element: HTMLAudioElement) => { element.muted = true; });
  await expect(musicToggle(page)).not.toHaveAttribute("data-state", "playing");
  await expect(musicToggle(page).locator(".music-note")).toHaveCSS("animation-name", "none");
  await musicAudio(page).evaluate((element: HTMLAudioElement) => { element.muted = false; });
  await expectNativePlaying(page);

  // An external native pause must stop the playing indicator; intent alone is not playing.
  await musicAudio(page).evaluate((element: HTMLAudioElement) => element.pause());
  await expectMusicStopped(page);
  await expect(musicToggle(page)).not.toHaveClass(/is-playing/);
  await expect(musicToggle(page).locator(".music-note")).toHaveCSS("animation-name", "none");
  // Native pause leaves the enabled player waiting; first click explicitly turns
  // it off, then the next click starts it again.
  await musicToggle(page).click();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  await musicToggle(page).click();
  await startMusicIfBlocked(page);
  await musicToggle(page).click();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  await expect(musicToggle(page)).toHaveAccessibleName("开启背景音乐");
  await expect(musicToggle(page).locator(".music-slash")).toBeVisible();
  await expect(musicToggle(page)).not.toHaveClass(/is-playing/);
  await expectMusicStopped(page);
  await expect.poll(async () => (await musicProbe(page)).events.pause || 0).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("autoplay denial never shows playing and an explicit click retries native playback", async ({ page }) => {
  await observeMusic(page, true);
  await enterDemo(page);
  await uploadMusic(page, "自动播放重试");
  await selectMusic(page, "自动播放重试");
  await expect(musicToggle(page)).toHaveAttribute("data-state", "blocked");
  await expect(musicToggle(page)).toHaveAccessibleName("点击开启音乐");
  await expect(musicToggle(page)).not.toHaveClass(/is-playing/);
  await expect(musicToggle(page).locator(".music-note")).toHaveCSS("animation-name", "none");
  await expectMusicStopped(page);
  expect((await musicProbe(page)).denied).toBe(1);
  expect((await musicProbe(page)).events.playing || 0).toBe(0);
  await musicToggle(page).click();
  await expectNativePlaying(page);
  expect((await musicProbe(page)).playCalls).toBeGreaterThanOrEqual(2);
  expect((await musicProbe(page)).denied).toBe(1);
});

test("local off survives a selection change, logout clears audio, and demo files do not persist", async ({ page }) => {
  await observeMusic(page);
  await enterDemo(page);
  await uploadMusic(page, "会话音乐甲");
  await uploadMusic(page, "会话音乐乙", syntheticWav("session-two.wav", 440));
  await selectMusic(page, "会话音乐甲");
  await startMusicIfBlocked(page);
  await musicToggle(page).click();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  const before = await musicProbe(page);
  const source = await musicAudio(page).getAttribute("src");
  await selectMusic(page, "会话音乐乙");
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  await expectMusicStopped(page);
  expect((await musicProbe(page)).playCalls).toBe(before.playCalls);
  // Implementations may preload the new source or leave it empty while off.
  expect(await musicAudio(page).getAttribute("src")).not.toBe(source);
  await musicToggle(page).click();
  await startMusicIfBlocked(page);
  const audio = await musicAudio(page).elementHandle();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(musicToggle(page)).toBeVisible();
  await expect(musicToggle(page)).toBeDisabled();
  await expect.poll(() => audio!.evaluate((element: HTMLAudioElement) => element.paused && !element.getAttribute("src"))).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "进入我们的小世界", exact: true }).click();
  await page.getByRole("button", { name: "进入示例空间", exact: true }).click();
  await page.getByRole("link", { name: "管理我们的空间", exact: true }).click();
  await expect(musicPanel(page).getByRole("listitem")).toHaveCount(0);
  await expect(musicToggle(page)).toHaveAttribute("data-state", "empty");
});

test("375px dark and reduced-motion music controls remain usable without rotation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await observeMusic(page);
  await enterDemo(page);
  await uploadMusic(page, "手机合成音乐");
  await selectMusic(page, "手机合成音乐");
  await startMusicIfBlocked(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(musicToggle(page).locator(".music-note")).toHaveCSS("animation-name", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".toast")).toBeHidden();
  await musicPanel(page).screenshot({ path: test.info().outputPath("music-mobile-dark.png"), animations: "disabled" });
  await test.info().attach("music-mobile-dark", { path: test.info().outputPath("music-mobile-dark.png"), contentType: "image/png" });
  const bounds = await musicToggle(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(await musicToggle(page).evaluate(button => button.getAnimations({ subtree: true }).every(animation => {
    const timing = animation.effect?.getComputedTiming();
    return animation.playState !== "running" || typeof timing?.duration === "number" && timing.duration <= 1;
  }))).toBe(true);
  await musicToggle(page).click();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "off");
  await expectMusicStopped(page);
  await musicToggle(page).click();
  await startMusicIfBlocked(page);
  await confirmDeleteMusic(page, "手机合成音乐");
  await expectMusicStopped(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
