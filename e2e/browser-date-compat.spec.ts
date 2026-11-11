import { test, expect } from "../frontend/node_modules/@playwright/test/index";

test("页面启动兼容 en-CA 返回月/日/年的浏览器", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Reproduce locale data differences without changing Chinese-calendar support.
    Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
      construct(Target, args) {
        if (args[0] === "en-CA") args[0] = "en-US";
        return Reflect.construct(Target, args);
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  expect(errors).toEqual([]);
});
