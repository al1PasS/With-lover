import {
  test,
  expect,
  type Locator,
  type Page,
} from "../frontend/node_modules/@playwright/test/index";
import {
  createPlaceImages,
  listCalls,
  mockPlacesApi,
  readerCalls,
  replacementVersion,
  type PlaceImages,
} from "./places-fixtures";

// Opt-in only: this must target the separately launched VITE_DEMO=false frontend, never 8088/real data.
test.skip(
  process.env.PLACES_REAL_UI_TEST !== "true",
  "requires real-mode Vite on 5174 and synthetic API mocks",
);
test.use({ baseURL: "http://127.0.0.1:5174" });
let images: PlaceImages;
const checks = new WeakMap<
  Page,
  { errors: string[]; api: Awaited<ReturnType<typeof mockPlacesApi>> }
>();
test.beforeAll(async ({ browser }) => {
  images = await createPlaceImages(browser);
});
test.afterEach(async ({ page }) => {
  const check = checks.get(page);
  if (check) {
    expect(
      check.api.unexpected,
      "all API calls must remain inside the explicit synthetic contract",
    ).toEqual([]);
    expect(check.errors, "no uncaught browser errors").toEqual([]);
  }
});

async function setup(
  page: Page,
  options: Parameters<typeof mockPlacesApi>[2] = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const api = await mockPlacesApi(page, images, options);
  checks.set(page, { errors, api });
  return api;
}
async function ready(page: Page) {
  await expect(page.locator(".custom-place")).toHaveCount(3);
  await expect(
    page.locator(".custom-place").first().locator("img.place-panorama"),
  ).toHaveAttribute("data-ready", "true");
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
    "the document must not scroll horizontally",
  ).toBeLessThanOrEqual(1);
}
async function centered(scroll: Locator) {
  await expect
    .poll(async () =>
      scroll.evaluate((element) =>
        Math.abs(
          element.scrollLeft - (element.scrollWidth - element.clientWidth) / 2,
        ),
      ),
    )
    .toBeLessThanOrEqual(2);
}
async function completeBanner(card: Locator) {
  const viewport = card.locator(".place-panorama-scroll");
  const image = card.locator("img.place-panorama");
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute("data-ready", "true");
  const geometry = await viewport.evaluate((element) => {
    const image =
      element.querySelector<HTMLImageElement>("img.place-panorama")!;
    const frame = element.querySelector<HTMLElement>(".place-image-frame")!;
    const bounds = element.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    return {
      viewportRatio: bounds.width / bounds.height,
      frameRatio: frameBounds.width / frameBounds.height,
      // Check the actual rendered img, not just natural dimensions or a wrapper.
      imageRatio: imageBounds.width / imageBounds.height,
      naturalRatio: image.naturalWidth / image.naturalHeight,
      objectFit: getComputedStyle(image).objectFit,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      verticalOverflow: element.scrollHeight - element.clientHeight,
      leftInset: imageBounds.left - bounds.left,
      rightInset: bounds.right - imageBounds.right,
      topInset: imageBounds.top - bounds.top,
      bottomInset: bounds.bottom - imageBounds.bottom,
    };
  });
  expect(
    geometry.viewportRatio,
    "the full card banner is about 7:1",
  ).toBeCloseTo(7, 1);
  expect(
    geometry.frameRatio,
    "the image frame retains the complete panorama",
  ).toBeCloseTo(7, 1);
  expect(
    geometry.imageRatio,
    "the actual img CSS box is about 7:1",
  ).toBeCloseTo(7, 1);
  expect(geometry.naturalRatio).toBeCloseTo(7, 1);
  expect(geometry.objectFit, "do not crop or stretch the panorama").toBe(
    "contain",
  );
  expect(
    geometry.horizontalOverflow,
    "no horizontally scrollable local window",
  ).toBeLessThanOrEqual(1);
  expect(
    geometry.verticalOverflow,
    "no clipped vertical image overflow",
  ).toBeLessThanOrEqual(1);
  for (const inset of [
    geometry.leftInset,
    geometry.rightInset,
    geometry.topInset,
    geometry.bottomInset,
  ])
    expect(
      Math.abs(inset),
      "the whole img fits edge-to-edge inside the banner",
    ).toBeLessThanOrEqual(1);
}
async function managementOutsideImage(card: Locator) {
  const image = await card.locator(".place-panorama-scroll").boundingBox();
  const buttons = card.locator(".place-admin-actions button");
  await expect(buttons).toHaveCount(4);
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box!.width, "management touch width").toBeGreaterThanOrEqual(44);
    expect(box!.height, "management touch height").toBeGreaterThanOrEqual(44);
    expect(
      box!.y,
      "management controls must sit below, not overlay, the panorama",
    ).toBeGreaterThanOrEqual(image!.y + image!.height);
  }
}
async function captureScreenshot(page: Page, name: string) {
  // Per-run artifacts stay in ignored test-results; curated examples are kept separately.
  const path = test.info().outputPath(`places-banner-${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
}

const layouts = [
  { name: "mobile-375", width: 375, height: 812, dark: false },
  { name: "mobile-390-dark", width: 390, height: 844, dark: true },
  { name: "tablet-768", width: 768, height: 1024, dark: false },
  { name: "desktop", width: 1440, height: 900, dark: false },
  { name: "landscape-dark", width: 844, height: 390, dark: true },
] as const;

for (const layout of layouts) {
  test(`${layout.name}: complete 7:1 banner, accessible viewer and centered on-demand reader`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.emulateMedia({
      colorScheme: layout.dark ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const api = await setup(page);
    await page.goto("/places");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      layout.dark ? "dark" : "light",
    );
    await noOverflow(page);
    const card = page.locator(".custom-place").first();
    await managementOutsideImage(card);
    for (const banner of await page.locator(".custom-place").all())
      await completeBanner(banner);
    await card.scrollIntoViewIfNeeded();
    const loaded = await card
      .locator("img.place-panorama")
      .evaluate((image: HTMLImageElement) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
        src: image.currentSrc,
      }));
    expect(loaded.width / loaded.height).toBeCloseTo(7, 1);
    expect(loaded.src).toContain("/api/v1/media/places/");
    expect(readerCalls(api)).toHaveLength(0);
    expect(listCalls(api)).toHaveLength(1);
    for (const path of ["/memories", "/trash", "/anniversaries"])
      expect(listCalls(api, path)).toHaveLength(0);
    await captureScreenshot(page, layout.name);

    const trigger = card.locator(".place-expand");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "合成海湾 · 旅行长卷" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".place-viewer-scroll")).toHaveAttribute(
      "data-mode",
      "fit",
    );
    await expect(
      dialog.getByRole("button", { name: "完整适应", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("img.place-panorama")).toHaveAttribute(
      "data-ready",
      "true",
    );
    expect(
      readerCalls(api),
      "opening fit mode must not fetch 3200",
    ).toHaveLength(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(layout.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(layout.height + 1);
    await dialog.getByRole("button", { name: "横向细读", exact: true }).click();
    const reader = dialog.locator('.place-viewer-scroll[data-mode="read"]');
    await expect(reader.locator("img")).toHaveAttribute("data-ready", "true");
    await expect
      .poll(() =>
        reader
          .locator("img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(3200);
    expect(readerCalls(api)).toHaveLength(1);
    expect(
      await reader.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeGreaterThan(100);
    await centered(reader);
    await reader.focus();
    await reader.press("End");
    await expect
      .poll(() =>
        reader.evaluate((element) =>
          Math.abs(
            element.scrollLeft - element.scrollWidth + element.clientWidth,
          ),
        ),
      )
      .toBeLessThanOrEqual(2);
    await reader.press("Home");
    await expect
      .poll(() => reader.evaluate((element) => element.scrollLeft))
      .toBe(0);
    expect(
      await reader.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
      "the keyboard reader must have a visible focus indicator",
    ).not.toBe("none");
    // Radix makes background controls inert: invoke the existing theme button's
    // React handler directly to test an unrelated App re-render, not backdrop access.
    for (const dark of [!layout.dark, layout.dark]) {
      await page
        .locator(`button[aria-label="${dark ? "切换深色" : "切换浅色"}"]`)
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        dark ? "dark" : "light",
      );
      await settleReact(page);
      await expect(reader).toHaveAttribute("data-mode", "read");
      expect(
        await reader.evaluate((element) => element.scrollLeft),
        "a theme re-render must preserve manual reader position, not recenter",
      ).toBe(0);
    }
    expect(
      readerCalls(api),
      "theme updates must not reload the reader image",
    ).toHaveLength(1);
    await noOverflow(page);
    if (layout.name === "mobile-390-dark")
      await captureScreenshot(page, "reader-mobile-deepdark");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await noOverflow(page);
  });
}

test("text-only edit preserves the complete image; PNG replacement sends only the chosen image", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const api = await setup(page);
  await page.goto("/places");
  await ready(page);
  const card = page.locator(".custom-place").first();
  await completeBanner(card);
  const originalSrc = await card
    .locator("img.place-panorama")
    .evaluate((image: HTMLImageElement) => image.currentSrc);
  await card.getByRole("button", { name: "编辑合成海湾", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(
    editor.getByRole("img", { name: "城市长卷预览" }),
  ).toHaveAttribute("src", /\/api\/v1\/media\/places\//);
  await editor
    .getByLabel("一句话说明")
    .fill("纯合成文字编辑后仍完整展示原长卷");
  await editor.getByRole("button", { name: "保存足迹", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(card).toContainText("纯合成文字编辑后仍完整展示原长卷");
  const edits = () =>
    api.calls.filter(
      (call) =>
        call.path === "/admin/places/synthetic-place-1" &&
        call.method === "PATCH",
    );
  expect(edits()).toHaveLength(1);
  expect(edits()[0].body).toEqual({
    city: "合成海湾",
    description: "纯合成文字编辑后仍完整展示原长卷",
    visitDate: "2026-10-12",
  });
  expect(edits()[0].body).not.toHaveProperty("panoramaImage");
  await completeBanner(card);
  expect(
    await card
      .locator("img.place-panorama")
      .evaluate((image: HTMLImageElement) => image.currentSrc),
  ).toBe(originalSrc);
  expect(listCalls(api)).toHaveLength(1);

  await card.getByRole("button", { name: "编辑合成海湾", exact: true }).click();
  await editor.locator('input[type="file"]').setInputFiles({
    name: "synthetic-panorama.png",
    mimeType: "image/png",
    buffer: images.replacementPng,
  });
  await expect(
    editor.getByRole("button", { name: "取消替换", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "保存足迹", exact: true }),
  ).toBeEnabled();
  await noOverflow(page);
  await editor.getByRole("button", { name: "保存足迹", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(edits()).toHaveLength(2);
  expect(edits()[1].body!.panoramaImage).toMatch(
    /^data:image\/(?:jpeg|png|webp);base64,/,
  );
  expect(Object.keys(edits()[1].body!).sort()).toEqual([
    "city",
    "description",
    "panoramaImage",
    "visitDate",
  ]);
  await expect(card.locator("img.place-panorama")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect
    .poll(() =>
      card
        .locator("img.place-panorama")
        .evaluate((image: HTMLImageElement) => image.currentSrc),
    )
    .toContain(replacementVersion);
  await completeBanner(card);
  expect(listCalls(api)).toHaveLength(1);
});

test("list failure has explicit retry and single-image failure can recover without reloading the list", async ({
  page,
}) => {
  const api = await setup(page, {
    listFailures: 1,
    imageFailures: ["synthetic-place-1"],
  });
  await page.goto("/places");
  await expect(page.getByRole("alert")).toContainText("合成足迹列表暂时不可用");
  expect(listCalls(api)).toHaveLength(1);
  await page.getByRole("button", { name: "重新加载足迹", exact: true }).click();
  await expect(page.locator(".custom-place")).toHaveCount(3);
  const card = page.locator(".custom-place").first();
  await expect(card).toContainText("这幅长卷暂时未能加载");
  expect(listCalls(api)).toHaveLength(2);
  await card.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(card.locator("img.place-panorama")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(
    card.getByRole("button", { name: "重新加载", exact: true }),
  ).not.toBeVisible();
  expect(listCalls(api)).toHaveLength(2);
  await noOverflow(page);
});

test("route-scoped loading, direct activity link and history navigation do not duplicate lists", async ({
  page,
}) => {
  const api = await setup(page);
  await page.goto("/places?activity=synthetic-place-2");
  await ready(page);
  await expect(page.locator("#activity-synthetic-place-2")).toHaveClass(
    /activity-focus/,
  );
  expect(listCalls(api)).toHaveLength(1);
  for (const path of ["/memories", "/trash", "/anniversaries"])
    expect(listCalls(api, path)).toHaveLength(0);
  await page
    .getByRole("link", { name: "时光", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/timeline$/);
  await expect.poll(() => listCalls(api, "/memories").length).toBe(1);
  expect(listCalls(api, "/trash")).toHaveLength(0);
  expect(listCalls(api, "/anniversaries")).toHaveLength(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/places\?activity=synthetic-place-2$/);
  await ready(page);
  await expect.poll(() => listCalls(api).length).toBe(2);
  await expect(page.locator("#activity-synthetic-place-2")).toHaveClass(
    /activity-focus/,
  );
  await page.goForward();
  await expect(page).toHaveURL(/\/timeline$/);
  expect(listCalls(api, "/memories")).toHaveLength(1);
});

test("late private list response cannot repopulate footprints after logout", async ({
  page,
}) => {
  const api = await setup(page, { holdList: true });
  await page.goto("/places");
  await expect.poll(() => listCalls(api).length).toBe(1);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator("main")).toContainText("足迹");
  await api.releaseList();
  // Allow the held network response and React work to settle, not an arbitrary sleep.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator(".custom-place")).toHaveCount(0);
  await expect(page.getByText("合成海湾", { exact: true })).not.toBeVisible();
  expect(api.signedIn).toBe(false);
  expect(listCalls(api)).toHaveLength(1);
  await noOverflow(page);
});

test("ordering and confirmed deletion update cards without unrelated list fetches", async ({
  page,
}) => {
  const api = await setup(page);
  await page.goto("/places");
  await ready(page);
  await expect(
    page.getByRole("button", { name: "上移合成海湾", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "下移合成原野", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "下移合成海湾", exact: true }).click();
  await expect(page.locator(".custom-place h2")).toHaveText([
    "合成山城",
    "合成海湾",
    "合成原野",
  ]);
  await expect
    .poll(
      () =>
        api.calls.filter((call) => call.path === "/admin/places/reorder")
          .length,
    )
    .toBe(1);
  expect(
    api.calls.find((call) => call.path === "/admin/places/reorder")!.body,
  ).toEqual({
    ids: ["synthetic-place-2", "synthetic-place-1", "synthetic-place-3"],
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除合成海湾", exact: true }).click();
  await expect(page.locator(".custom-place h2")).toHaveText([
    "合成山城",
    "合成原野",
  ]);
  expect(
    api.calls.filter(
      (call) =>
        call.path === "/admin/places/synthetic-place-1" &&
        call.method === "DELETE",
    ),
  ).toHaveLength(1);
  expect(listCalls(api)).toHaveLength(1);
  for (const path of ["/memories", "/trash", "/anniversaries"])
    expect(listCalls(api, path)).toHaveLength(0);
});

async function submitSyntheticPlace(page: Page) {
  await page.getByRole("button", { name: "上传长卷", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("城市名").fill("合成新增城市");
  await editor.getByLabel("一句话说明").fill("竞态回归专用合成记录");
  await editor.locator('input[type="file"]').setInputFiles({
    name: "synthetic-created.png",
    mimeType: "image/png",
    buffer: images.replacementPng,
  });
  await expect(
    editor.getByRole("button", { name: "发布到足迹", exact: true }),
  ).toBeEnabled();
  await editor.getByRole("button", { name: "发布到足迹", exact: true }).click();
}
async function settleReact(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("create while initial list is held re-fetches the complete collection instead of marking a partial list ready", async ({
  page,
}) => {
  const api = await setup(page, { holdList: true });
  await page.goto("/places");
  await expect.poll(() => listCalls(api).length).toBe(1);
  await expect(page.locator(".custom-place")).toHaveCount(0);
  const oldList = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      new URL(request.url()).pathname === "/api/v1/places",
  });
  await submitSyntheticPlace(page);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await oldList;
  await expect.poll(() => listCalls(api).length).toBe(2);
  await expect(page.locator(".custom-place h2")).toHaveText([
    "合成海湾",
    "合成山城",
    "合成原野",
    "合成新增城市",
  ]);
  await api.releaseList();
  await settleReact(page);
  await expect(page.locator(".custom-place h2")).toHaveText([
    "合成海湾",
    "合成山城",
    "合成原野",
    "合成新增城市",
  ]);
  expect(
    api.calls.filter(
      (call) => call.path === "/admin/places" && call.method === "POST",
    ),
  ).toHaveLength(1);
  expect(listCalls(api)).toHaveLength(2);
  for (const path of ["/memories", "/trash", "/anniversaries"])
    expect(listCalls(api, path)).toHaveLength(0);
});

test("late create response after logout cannot abort or contaminate the in-flight public list", async ({
  page,
}) => {
  const api = await setup(page, {
    holdCreate: true,
    publicPlaces: true,
    holdPublicList: true,
  });
  const failedPublic: string[] = [];
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/public/places")
      failedPublic.push(request.failure()?.errorText || "aborted");
  });
  await page.goto("/places");
  await ready(page);
  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/admin/places" &&
      response.request().method() === "POST",
  );
  await submitSyntheticPlace(page);
  await expect
    .poll(
      () =>
        api.calls.filter(
          (call) => call.path === "/admin/places" && call.method === "POST",
        ).length,
    )
    .toBe(1);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "正在保存…", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect.poll(() => listCalls(api, "/public/places").length).toBe(1);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".custom-place")).toHaveCount(0);

  // Deliberately release the stale private write while the visitor GET is still in flight.
  await api.releaseCreate();
  await (await createResponse).finished();
  await settleReact(page);
  await expect(page.locator(".custom-place")).toHaveCount(0);
  expect(
    failedPublic,
    "a stale mutation must not cancel the current visitor resource",
  ).toEqual([]);
  const publicResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/public/places",
  );
  await api.releasePublicList();
  await (await publicResponse).finished();
  await expect(page.locator(".custom-place h2")).toHaveText([
    "合成海湾",
    "合成山城",
    "合成原野",
    "合成新增城市",
  ]);
  for (const image of await page
    .locator(".custom-place img.place-panorama")
    .all()) {
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveAttribute("data-ready", "true");
    expect(
      await image.evaluate((element: HTMLImageElement) => element.currentSrc),
    ).toContain("/api/v1/public/media/places/");
  }
  await expect(page.locator(".place-admin-actions")).toHaveCount(0);
  expect(failedPublic).toEqual([]);
  expect(listCalls(api)).toHaveLength(1);
  expect(listCalls(api, "/public/places")).toHaveLength(1);
  expect(api.signedIn).toBe(false);
});
