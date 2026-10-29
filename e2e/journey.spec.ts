import { test, expect } from "../frontend/node_modules/@playwright/test/index";
test("desktop public browsing and demo record lifecycle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /把我们/ })).toBeVisible();
  await page.screenshot({
    path: "../e2e/screenshots/desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "进入我们的小世界" }).click();
  await page.getByRole("button", { name: "进入示例空间", exact: true }).click();
  await page.getByRole("button", { name: "记录此刻", exact: true }).click();
  await page.getByLabel("给这一刻起个名字").fill("一起吃早餐");
  await page.getByLabel("想记住的故事").fill("热腾腾的豆浆和包子。");
  await page.getByRole("button", { name: "收藏这一刻" }).click();
  await expect(page.getByRole("status")).toContainText("好好收藏");
  await page.getByRole("link", { name: "管理我们的空间", exact: true }).click();
  const row = page.locator(".admin-row").filter({ hasText: "一起吃早餐" });
  await expect(row).toContainText("双人私密");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("给这一刻起个名字").fill("一起吃早餐，真好");
  await page.getByRole("button", { name: "收藏这一刻" }).click();
  await page.getByRole("button", { name: "删除一起吃早餐，真好" }).click();
  await expect(row).toContainText("回收站");
  await row.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(row).toContainText("双人私密");
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto("/timeline?q=一起吃早餐");
  await expect(page.getByText("这里还没有回忆")).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "切换深色" }).click();
  await page.screenshot({
    path: "../e2e/screenshots/dark.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
test("mobile navigation, search, lightbox and reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.screenshot({
    path: "../e2e/screenshots/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "进入我们的小世界" }).click();
  await page.getByRole("button", { name: "进入示例空间", exact: true }).click();
  await page
    .getByRole("navigation", { name: "手机导航" })
    .getByRole("link", { name: "时光" })
    .click();
  await page.getByLabel("搜索回忆").fill("日落");
  await expect(page.locator(".memory-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "把日落，装进口袋里", exact: true })
    .last()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "手机导航" })
    .getByRole("link", { name: "足迹" })
    .click();
  await expect(page.getByText("足迹还没有内容")).toBeVisible();
});

test('responsive pages stay inside viewport', async ({ page }) => {
  for (const [width, height] of [[375, 812], [812, 375], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    for (const route of ['/', '/timeline', '/albums', '/albums/our-trips', '/places', '/anniversaries', '/admin', '/records', '/play', '/wishes']) {
      await page.goto(route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test("visitor privacy settings hide real and sample content", async ({ page }) => {
  await page.goto("/records");
  await expect(page.getByRole("heading", { name: "记录盒里，留着彼此的话" })).toBeVisible();
  await expect(page.getByText("隔空抱抱")).toHaveCount(0);

  await page.getByRole("button", { name: "登录后再看" }).click();
  await page.getByRole("button", { name: "进入示例空间", exact: true }).click();
  await page.goto("/admin");
  await page.getByLabel(/完全私密/).check();
  await page.getByRole("button", { name: "保存访客设置" }).click();
  await expect(page.getByRole("status")).toContainText("访客入口");
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto("/timeline");
  await expect(page.getByRole("heading", { name: "这些时光，等登录后再一起翻看" })).toBeVisible();
});
