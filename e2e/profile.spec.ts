import { test, expect } from "../frontend/node_modules/@playwright/test/index";

// Run against a second Vite server built with VITE_DEMO=false; all API data here is synthetic.
test.skip(process.env.PROFILE_REAL_UI_TEST !== "true", "requires real-mode Vite on 5174");
test.use({ baseURL: "http://127.0.0.1:5174" });
test.beforeEach(async ({ page }) => {
  let profile = { id: 1, username: "profile_test", nickname: "测试昵称", role: "ADMIN" }, signedIn = true;
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith("/auth/me")) data = signedIn ? { name: profile.nickname, role: profile.role } : { name: null, role: null };
    else if (path.endsWith("/auth/csrf")) data = { token: "test-csrf", headerName: "X-CSRF-TOKEN" };
    else if (path.endsWith("/public/privacy")) data = { mode: "PRIVATE", home: false, timeline: false, anniversaries: false, albums: false, places: false };
    else if (path.endsWith("/activities")) data = { items: [], unread: 0, latestId: 0, nextCursor: null };
    else if (path.endsWith("/account/profile")) {
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        if ((input.newPassword || input.username && input.username !== profile.username) && input.oldPassword !== "current-test-only") {
          await route.fulfill({ status: 400, json: { message: "旧密码不正确" } }); return;
        }
        const loginRequired = Boolean(input.newPassword || input.username && input.username !== profile.username);
        profile = { ...profile, nickname: input.nickname || profile.nickname, username: input.username || profile.username };
        if (loginRequired) signedIn = false;
        data = { profile, loginRequired };
      } else data = profile;
    } else if (path.endsWith("/media/cover")) { await route.fulfill({ status: 302, headers: { location: "/images/cover.webp" } }); return; }
    await route.fulfill({ json: data });
  });
});

test("nickname and password forms validate, show server errors, and require login after success", async ({ page }) => {
  await page.goto("/admin");
  const info = page.getByRole("form", { name: "维护个人资料" });
  await expect(page.getByLabel("登录用户名", { exact: true })).toHaveValue("profile_test");
  await page.getByLabel("昵称", { exact: true }).fill("新的昵称");
  await info.getByRole("button", { name: "保存个人信息" }).click();
  await expect(page.getByRole("status").filter({ hasText: "个人信息已保存" }).first()).toBeVisible();
  const password = page.getByRole("form", { name: "修改登录密码" });
  await page.getByLabel("旧密码", { exact: true }).fill("current-test-only");
  await page.getByLabel("新密码", { exact: true }).fill("replacement-test-only");
  await page.getByLabel("确认新密码", { exact: true }).fill("different-test-only");
  await password.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(password.getByRole("alert")).toContainText("两次输入的新密码不一致");
  await page.getByLabel("确认新密码", { exact: true }).fill("replacement-test-only");
  await page.getByLabel("旧密码", { exact: true }).fill("incorrect-test-only");
  await password.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(password.getByRole("alert")).toContainText("旧密码不正确");
  await page.getByLabel("旧密码", { exact: true }).fill("current-test-only");
  await password.getByRole("button", { name: "显示旧密码", exact: true }).click();
  await expect(page.getByLabel("旧密码", { exact: true })).toHaveAttribute("type", "text");
  await password.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("更新后的账号信息重新登录");
});

test("mobile personal information supports username edits and stays inside viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin");
  await page.getByLabel("登录用户名", { exact: true }).fill("renamed_test");
  await expect(page.getByLabel("当前密码（修改用户名）", { exact: true })).toBeVisible();
  await page.getByLabel("当前密码（修改用户名）", { exact: true }).fill("current-test-only");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("profile-mobile.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "保存个人信息" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
