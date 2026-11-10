import { Buffer } from "node:buffer";
import { expect, type Page } from "../frontend/node_modules/@playwright/test/index";

// Generated PCM only: never read the project's personal audio or download a fixture.
export function syntheticWav(name = "music-e2e.wav", frequency = 220) {
  const sampleRate = 16_000;
  const samples = sampleRate * 12;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) {
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * sample / sampleRate) * 256), 44 + sample * 2);
  }
  return { name, mimeType: "audio/wav", buffer };
}

type MusicProbe = { playCalls: number; denied: number; events: Record<string, number> };
declare global {
  interface Window { __musicProbe: MusicProbe }
}

// Observe native playback. Only the denial test intercepts one play() rejection;
// the retry and every successful playing event still come from a real WAV decoder.
export async function observeMusic(page: Page, denyFirstPlay = false) {
  await page.addInitScript(({ denyFirstPlay }) => {
    const probe: MusicProbe = { playCalls: 0, denied: 0, events: {} };
    window.__musicProbe = probe;
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) {
        probe.playCalls++;
        if (denyFirstPlay && probe.denied === 0) {
          probe.denied++;
          return Promise.reject(new DOMException("Synthetic autoplay policy denial", "NotAllowedError"));
        }
      }
      return nativePlay.call(this);
    };
    for (const name of ["playing", "pause", "waiting", "error", "ended", "emptied"]) {
      document.addEventListener(name, event => {
        if (event.target instanceof HTMLAudioElement) probe.events[name] = (probe.events[name] || 0) + 1;
      }, true);
    }
  }, { denyFirstPlay });
}

export const musicPanel = (page: Page) => page.getByRole("region", { name: "背景音乐", exact: true });
export const musicToggle = (page: Page) => page.getByTestId("background-music-toggle");
export const musicAudio = (page: Page) => page.getByTestId("background-audio");
export const musicRow = (page: Page, title: string) => musicPanel(page).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });

export async function uploadMusic(page: Page, title: string, file = syntheticWav()) {
  const panel = musicPanel(page);
  await panel.getByLabel("歌曲名称（可选）", { exact: true }).fill(title);
  await panel.getByLabel("选择音乐文件", { exact: true }).setInputFiles(file);
  await panel.getByRole("button", { name: "上传音乐", exact: true }).click();
  await expect(musicRow(page, title)).toBeVisible();
}

export async function selectMusic(page: Page, title: string) {
  await musicRow(page, title).getByRole("button", { name: "设为背景音乐", exact: true }).click();
  await expect(musicRow(page, title).getByText("当前背景音乐", { exact: true })).toBeVisible();
}

export async function expectNativePlaying(page: Page) {
  await expect(musicToggle(page)).toHaveAttribute("data-state", "playing");
  await expect(musicToggle(page)).toHaveAccessibleName("关闭背景音乐");
  await expect.poll(() => musicAudio(page).evaluate((audio: HTMLAudioElement) =>
    !audio.paused && !audio.muted && audio.volume > 0 && audio.readyState >= 2 && audio.currentTime > 0 && audio.loop,
  )).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__musicProbe.events.playing || 0)).toBeGreaterThan(0);
}

// Normal Chrome may allow or deny autoplay depending on its policy. Both are valid;
// explicit user activation must always lead to actual native playback.
export async function startMusicIfBlocked(page: Page) {
  await expect(musicToggle(page)).toHaveAttribute("data-state", /^(playing|blocked)$/);
  if (await musicToggle(page).getAttribute("data-state") === "blocked") await musicToggle(page).click();
  await expectNativePlaying(page);
}

export async function musicProbe(page: Page) {
  return page.evaluate(() => window.__musicProbe);
}

export async function expectMusicStopped(page: Page) {
  await expect.poll(() => musicAudio(page).evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  await expect(musicToggle(page)).not.toHaveAttribute("data-state", "playing");
}

export async function confirmDeleteMusic(page: Page, title: string) {
  await musicRow(page, title).getByRole("button", { name: `删除音乐：${title}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除这首音乐？", exact: true });
  await expect(dialog).toContainText(title);
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(musicRow(page, title)).toHaveCount(0);
}
