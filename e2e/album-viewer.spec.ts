import {
  expect,
  test,
  type CDPSession,
} from "../frontend/node_modules/@playwright/test/index";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 375, height: 812 },
});

async function swipe(
  cdp: CDPSession,
  start: { x: number; y: number },
  dx: number,
  dy = 0,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start.x + dx * fraction, y: start.y + dy * fraction }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("album viewer follows swipes, keeps both ends, and supports buttons and keyboard", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const photos = ["#a44f60", "#747f61", "#66516a"].map((color, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = index === 1 ? 100 : 300;
      canvas.height = index === 1 ? 300 : 100;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL("image/png");
      return {
        id: `synthetic-${index}`,
        src,
        thumbnail: src,
        note: `照片说明 ${index + 1}`,
        date: "2026-01-01",
      };
    });
    localStorage.setItem(
      "shiguang:privacy",
      JSON.stringify({ mode: "SELECTED", albums: true }),
    );
    const album = {
      title: "合成相册",
      description: "",
      category: "event",
      date: "2026-01-01",
      coverId: null,
    };
    localStorage.setItem(
      "shiguang:albums",
      JSON.stringify([
        { ...album, id: "synthetic-album", photos },
        { ...album, id: "single-photo", photos: photos.slice(0, 1) },
      ]),
    );
  });

  await page.goto("/albums/synthetic-album");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const first = page.getByRole("button", { name: "查看第 1 张照片" });
  await first.click();
  const viewer = page.getByRole("dialog");
  const stage = viewer.locator(".album-detail-image");
  const position = viewer.getByRole("heading");
  const previous = viewer.getByRole("button", { name: "上一张照片" });
  const next = viewer.getByRole("button", { name: "下一张照片" });
  const frame = (await stage.boundingBox())!;
  const center = {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
  const cdp = await page.context().newCDPSession(page);

  await expect(position).toHaveText("照片 1 / 3");
  await expect(previous).toBeDisabled();
  await swipe(cdp, center, 100);
  await swipe(cdp, center, -24);
  await swipe(cdp, center, -60, 100);
  await expect(position).toHaveText("照片 1 / 3");

  await swipe(cdp, center, -100);
  await expect(position).toHaveText("照片 2 / 3");
  await expect(stage.getByRole("img")).toHaveJSProperty("naturalHeight", 300);
  await expect(viewer.getByText("照片说明 2")).toBeVisible();
  expect((await stage.boundingBox())?.height).toBe(frame.height);
  await viewer.screenshot({ path: testInfo.outputPath("portrait-dark.png") });
  await swipe(cdp, center, -100);
  await expect(position).toHaveText("照片 3 / 3");
  await expect(next).toBeDisabled();
  await swipe(cdp, center, -100);
  await expect(position).toHaveText("照片 3 / 3");
  await swipe(cdp, center, 100);
  await expect(position).toHaveText("照片 2 / 3");

  const target = (await previous.boundingBox())!;
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await previous.click();
  await expect(position).toHaveText("照片 1 / 3");
  await expect(previous).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(position).toHaveText("照片 2 / 3");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(first).toBeFocused();

  await page.setViewportSize({ width: 812, height: 375 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "查看第 2 张照片" }).click();
  await expect(previous).toBeEnabled();
  await expect(next).toBeEnabled();
  await viewer.screenshot({ path: testInfo.outputPath("landscape-light.png") });
  const bounds = (await viewer.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(375);

  await page.goto("/albums/single-photo");
  await first.click();
  await expect(position).toHaveText("照片 1 / 1");
  await expect(previous).toHaveCount(0);
  await expect(next).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(position).toHaveText("照片 1 / 1");
});
