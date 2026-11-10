import { test, expect } from "../frontend/node_modules/@playwright/test/index";

test("updates created by one member remain unread for the other until opened", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.setItem("shiguang:demo-user", "杰杰"); });
  await page.goto("/wishes");
  await page.getByLabel("新的愿望").fill("一起去看极光");
  await page.getByRole("button", { name: "写下来", exact: true }).click();
  await expect(page.getByText("一起去看极光", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "最近更新，0 条未读" }).click();
  await expect(page.getByRole("dialog")).toContainText("暂时没有对方的更新");
  await page.getByRole("button", { name: "全部动态", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("一起去看极光");
  await page.keyboard.press("Escape");
  await page.evaluate(() => sessionStorage.setItem("shiguang:demo-user", "雯晴"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "最近更新，1 条未读" })).toBeVisible();
  await page.getByRole("button", { name: "最近更新，1 条未读" }).click();
  await expect(page.getByRole("dialog")).toContainText("一起去看极光");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "最近更新，1 条未读" })).toBeVisible();
  await page.getByRole("button", { name: "最近更新，1 条未读" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /杰杰，新增了愿望单，一起去看极光/ }).click();
  await expect(page).toHaveURL(/\/wishes\?activity=/);
  await expect(page.locator(".activity-focus")).toContainText("一起去看极光");
  await expect(page.getByRole("button", { name: "最近更新，0 条未读" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "最近更新，0 条未读" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile inbox handles deleted targets and remains inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.setItem("shiguang:demo-user", "雯晴");
    const item = { id: 10, actor: "杰杰", mine: false, module: "messages", targetId: "gone", action: "deleted", title: "睡前故事", summary: "删除了记录", route: "/records?activity=gone", createdAt: new Date().toISOString(), read: false, deleted: true };
    localStorage.setItem("shiguang:activities", JSON.stringify([item]));
  });
  await page.reload();
  await page.getByRole("button", { name: "最近更新，1 条未读" }).click();
  await expect(page.getByRole("dialog")).toContainText("内容已删除");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("activity-mobile.png"), animations: "disabled" });
  await page.getByRole("button", { name: "全部已读", exact: true }).click();
  await expect(page.getByRole("dialog").locator("footer")).toContainText("更新都收在这里了");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "切换深色" }).click();
  await page.getByRole("button", { name: "最近更新，0 条未读" }).click();
  await page.screenshot({ path: test.info().outputPath("activity-mobile-dark.png"), animations: "disabled" });
  await page.setViewportSize({ width: 812, height: 375 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
