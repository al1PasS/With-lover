import {
  expect, test, type APIRequestContext, type Locator,
} from "../frontend/node_modules/@playwright/test/index";
import {
  expectNativePlaying, musicAudio, musicPanel, musicToggle, observeMusic, selectMusic, syntheticWav, uploadMusic,
} from "./music-fixtures";

const baseURL = "http://127.0.0.1:5174";
const api = "/api/v1";
const androidUA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/110.0.0.0 Mobile Safari/537.36";
test.skip(process.env.MOBILE_MEDIA_REAL_TEST !== "true", "requires isolated Nginx, API and PostgreSQL");
test.use({
  baseURL,
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  userAgent: androidUA,
});

async function csrf(request: APIRequestContext) {
  const response = await request.get(`${api}/auth/csrf`);
  expect(response.ok()).toBe(true);
  const { headerName, token } = await response.json();
  return { [headerName]: token };
}

async function login(request: APIRequestContext, username = "activity-one") {
  const response = await request.post(`${api}/auth/login`, {
    headers: await csrf(request),
    data: { username, password: "shared-features-test-only" },
  });
  expect(response.status(), "use the synthetic accounts in the isolated test database").toBe(200);
}

async function expectVoicePlaying(audio: Locator) {
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  // Click the native play control at the leading edge of Chrome's audio bar.
  await audio.tap({ position: { x: 18, y: 20 } });
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0);
}

test("an existing voice note and a new recording play through the production proxy", async ({ browser, page }) => {
  await login(page.request);
  const settings = await page.request.get(`${api}/settings/messages`).then((r) => r.json());
  const existing = settings.value ? JSON.parse(settings.value) : [];
  const legacy = {
    id: `synthetic-voice-${Date.now()}`,
    type: "voice",
    title: `已有合成语音 ${Date.now()}`,
    body: "合成录音备注",
    date: "2026-11-13",
    audio: `data:audio/wav;base64,${syntheticWav().buffer.toString("base64")}`,
  };
  expect((await page.request.put(`${api}/settings/messages`, {
    headers: await csrf(page.request),
    data: { value: JSON.stringify([legacy, ...existing]), revision: settings.revision },
  })).ok()).toBe(true);
  await page.addInitScript(() => {
    // Older Chromium can provide getRandomValues without randomUUID.
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined });
    // Give the real MediaRecorder a synthetic input independent of host audio permissions.
    navigator.mediaDevices.getUserMedia = async () => {
      if (document.featurePolicy?.allowsFeature("microphone") === false)
        throw new DOMException("Microphone policy blocked recording", "NotAllowedError");
      const context = new AudioContext();
      const tone = context.createOscillator();
      const input = context.createMediaStreamDestination();
      tone.connect(input);
      tone.start();
      return input.stream;
    };
  });
  await page.goto("/records");
  await page.getByRole("button", { name: "语音口袋", exact: true }).tap();
  const saved = (title: string) => page.locator(".entry-stream article").filter({ hasText: title });
  await expectVoicePlaying(saved(legacy.title).getByLabel("播放语音"));
  await saved(legacy.title).locator("audio").evaluate((node: HTMLAudioElement) => node.pause());

  const submit = page.getByRole("button", { name: "放进记录盒" });
  await expect(submit).toBeDisabled();
  const title = `新录制的合成语音 ${Date.now()}`;
  await page.getByLabel("标题").fill(title);
  await page.getByRole("button", { name: "开始录一段声音" }).tap();
  const stop = page.getByRole("button", { name: "正在录音，点一下完成" });
  await expect(stop).toBeVisible();
  await expect(submit).toBeDisabled();
  // Allow the fake microphone to deliver multiple samples before stopping.
  await page.waitForTimeout(800);
  await stop.tap();
  const preview = page.getByLabel("试听录音");
  await expectVoicePlaying(preview);
  await submit.tap();
  await expect(preview).toHaveCount(0);
  await expectVoicePlaying(saved(title).getByLabel("播放语音"));

  const other = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await login(other.request, "activity-two");
    const partner = await other.newPage();
    await partner.goto("/records");
    await partner.getByRole("button", { name: "语音口袋", exact: true }).tap();
    await expectVoicePlaying(partner.locator(".entry-stream article")
      .filter({ hasText: title }).getByLabel("播放语音"));
  } finally {
    await other.close();
  }
});

test("one tap starts a pending Android autoplay and resumes after a native pause", async ({ page }) => {
  await login(page.request);
  await observeMusic(page, "pending");
  const title = `手机播放合成曲目 ${Date.now()}`;
  await page.goto("/admin");
  await uploadMusic(page, title);
  // Apply the selection from a fresh navigation, outside the selection click.
  await selectMusic(page, title);
  await page.reload();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "loading");
  await musicPanel(page).getByRole("button", { name: "播放音乐", exact: true }).tap();
  await expectNativePlaying(page);
  await musicAudio(page).evaluate((node: HTMLAudioElement) => node.pause());
  await expect(musicToggle(page)).toHaveAccessibleName("播放背景音乐");
  await musicToggle(page).tap();
  await expectNativePlaying(page);
  await musicPanel(page).getByRole("button", { name: "清空选曲" }).tap();
  await expect(musicToggle(page)).toHaveAttribute("data-state", "empty");
});

test("Android without push support can open recent updates from notification settings", async ({ page }) => {
  await login(page.request);
  await page.addInitScript(() => {
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { value: undefined });
  });
  await page.goto("/admin");
  const reminders = page.getByRole("region", { name: "消息提醒" });
  await expect(reminders).toContainText("如 Chrome");
  await expect(reminders.getByRole("button", { name: "开启系统通知" })).toHaveCount(0);
  await reminders.getByRole("link", { name: "查看最近更新" }).tap();
  await expect(page.getByRole("dialog", { name: "最近更新" })).toBeVisible();
});

test("Android uses the Service Worker to subscribe when page globals are missing", async ({ page }) => {
  await login(page.request);
  await page.addInitScript(() => {
    // Synthetic subscription, backed by Chrome's actual worker registration.
    Object.defineProperty(window, "PushManager", { value: undefined });
    Object.defineProperty(window, "Notification", { value: undefined });
    const keys = {
      // Public generator point on P-256, used only as a test subscription.
      p256dh: "BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
      auth: "AAAAAAAAAAAAAAAAAAAAAA",
    };
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-mobile-media",
      toJSON: () => ({ keys }),
      unsubscribe: async () => true,
    };
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
      value: {
        getSubscription: async () => sub,
        subscribe: (options: PushSubscriptionOptionsInit) => {
          if (!navigator.userActivation.isActive || !options.userVisibleOnly) throw new Error("Missing user activation");
          return Promise.resolve(sub);
        },
      },
    });
  });
  await page.goto("/admin");
  const reminders = page.getByRole("region", { name: "消息提醒" });
  const retry = reminders.getByRole("button", { name: "重试", exact: true });
  await expect.poll(async () => {
    if (await retry.isVisible()) await retry.click();
    return reminders.getByRole("button", { name: "开启系统通知" }).isEnabled();
  }).toBe(true);
  await reminders.getByRole("button", { name: "开启系统通知" }).tap();
  await expect(reminders.getByRole("button", { name: "关闭此设备的通知" })).toBeVisible();
  expect(await page.request.get(`${api}/push/status`).then((r) => r.json())).toMatchObject({ enabled: true });
  await reminders.getByRole("button", { name: "关闭此设备的通知" }).tap();
  await expect(reminders.getByRole("button", { name: "开启系统通知" })).toBeEnabled();
  expect(await page.request.get(`${api}/push/status`).then((r) => r.json())).toMatchObject({ enabled: false });
});
