import { test, expect, type Page } from "../frontend/node_modules/@playwright/test/index";

const baseURL = "http://127.0.0.1:5174";
test.use({ baseURL, viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
test.skip(process.env.SHARED_REAL_TEST !== "true", "requires the isolated real stack and two synthetic accounts");

async function login(page: Page, username: string) {
  await page.goto("/records");
  await page.getByRole("button", { name: "登录后再看" }).click();
  await page.getByLabel("账户").fill(username);
  await page.getByLabel("密码").fill("shared-features-test-only");
  await page.getByRole("dialog").getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
}

test("two members publish, react, rename and share album covers on mobile", async ({ browser, page }, testInfo) => {
  const suffix = Date.now();
  const record = `手机记录 ${suffix}`, memory = `手机回忆 ${suffix}`, wish = `去看日出 ${suffix}`, album = `手机相册 ${suffix}`;
  await login(page, "activity-one");
  const actor = await page.request.get("/api/v1/auth/me").then(r => r.json()).then(me => String(me.name));
  const updatedName = `改名后的甲${suffix}`;
  await page.getByLabel("标题").fill(record);
  await page.getByLabel("写下内容").fill("测试记录的内容");
  await page.getByRole("button", { name: "放进记录盒" }).click();
  const row = page.locator(".entry-stream article").filter({ hasText: record });
  await expect(row.locator("time").first()).toHaveText(/\d{2}:\d{2}/);

  await page.goto("/timeline");
  await page.getByRole("button", { name: "新增回忆" }).click();
  await page.getByLabel("给这一刻起个名字").fill(memory);
  await page.getByLabel("想记住的故事").fill("测试时光的内容");
  await page.getByRole("button", { name: "收藏这一刻" }).click();
  await page.getByRole("button", { name: memory, exact: true }).click();
  await expect(page.getByRole("dialog").locator(".memory-byline time")).toHaveText(/发布于 .*\d{2}:\d{2}/);
  await page.keyboard.press("Escape");

  await page.goto("/wishes");
  await page.getByLabel("新的愿望").fill(wish);
  await page.getByRole("button", { name: "写下来" }).click();
  await expect(page.locator(".wish-list article").filter({ hasText: wish })).toContainText(`提出人：${actor}`);

  const other = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, colorScheme: "dark" });
  const partner = await other.newPage();
  await login(partner, "activity-two");
  const theirRow = partner.locator(".entry-stream article").filter({ hasText: record });
  await theirRow.getByRole("button", { name: "点赞，0 个赞" }).click();
  await expect(theirRow.getByRole("button", { name: "取消赞，1 个赞" })).toHaveAttribute("aria-pressed", "true");
  await theirRow.getByRole("button", { name: "评论", exact: true }).click();
  await theirRow.getByLabel("写评论").fill("对方看到并留下了评论");
  await theirRow.getByRole("button", { name: "发送评论" }).click();
  await expect(theirRow.getByText("对方看到并留下了评论")).toBeVisible();
  expect(await partner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await partner.screenshot({ path: testInfo.outputPath("mobile-records-dark.png"), animations: "disabled" });

  await partner.goto("/timeline");
  await partner.getByRole("button", { name: memory, exact: true }).click();
  const dialog = partner.getByRole("dialog");
  await dialog.getByRole("button", { name: "点赞，0 个赞" }).click();
  await dialog.getByLabel("写评论").fill("时光里也可以评论");
  await dialog.getByRole("button", { name: "发送评论" }).click();
  await expect(dialog.getByText("时光里也可以评论")).toBeVisible();

  await page.goto("/admin");
  await page.getByLabel("昵称", { exact: true }).fill(updatedName);
  await page.getByRole("button", { name: "保存个人信息" }).click();
  await expect(page.getByText("个人信息已保存", { exact: true }).first()).toBeVisible();
  await partner.goto("/wishes");
  await expect(partner.locator(".wish-list article").filter({ hasText: wish })).toContainText(`提出人：${updatedName}`);
  await partner.goto("/records");
  await expect(theirRow).toContainText(`${updatedName} 写下`);

  await page.goto("/albums");
  await page.getByRole("button", { name: "新建相册" }).click();
  await page.getByLabel("相册名称").fill(album);
  await page.getByRole("button", { name: "创建并进入相册" }).click();
  await expect(page.getByRole("heading", { name: album })).toBeVisible();
  const albumURL = page.url();
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 200; canvas.height = 100;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#a44f60"; context.fillRect(0, 0, 200, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const good = Buffer.from(photo, "base64");
  await page.getByLabel("批量添加照片").setInputFiles([
    { name: "乱码-手机文件名.png", mimeType: "image/png", buffer: good },
    { name: "损坏.png", mimeType: "image/png", buffer: Buffer.from("invalid image") },
    { name: "另一张原始文件名.png", mimeType: "image/png", buffer: good },
  ]);
  await expect(page.getByText("已添加 2 张照片", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("1 张照片未能读取");
  await expect(page.getByText("乱码-手机文件名")).toHaveCount(0);
  await page.getByRole("button", { name: "查看第 2 张照片", exact: true }).click();
  await page.getByRole("button", { name: "设为相册封面" }).click();
  await expect(page.getByRole("button", { name: "当前封面" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("mobile-album-cover.png"), animations: "disabled" });
  await partner.goto(albumURL);
  await expect(partner.getByRole("button", { name: "查看第 2 张照片，封面" })).toBeVisible();

  const storage = await page.context().storageState();
  expect(storage.cookies.find(c => c.name === "SESSION")?.expires).toBeGreaterThan(Date.now() / 1000 + 86400);
  const reopened = await browser.newContext({ baseURL, storageState: storage });
  const next = await reopened.newPage();
  await next.goto("/records");
  await expect(next.getByRole("button", { name: "退出登录" })).toBeVisible();
  await next.getByRole("button", { name: "退出登录" }).click();
  await expect(next.getByRole("button", { name: "登录后再看" })).toBeVisible();
  await next.reload();
  await expect(next.getByRole("button", { name: "登录后再看" })).toBeVisible();
  await reopened.close();
  await other.close();
});
