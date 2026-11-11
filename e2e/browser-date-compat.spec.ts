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

for (const mode of ["missing-parts", "missing-calendar", "padded-month"] as const) {
  test(`安卓日期能力差异不阻断页面：${mode}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      if (mode === "missing-parts") {
        Object.defineProperty(Intl.DateTimeFormat.prototype, "formatToParts", { value: undefined });
      } else if (mode === "missing-calendar") {
        Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
          construct(Target, args) {
            if (String(args[0]).includes("chinese")) throw new RangeError("Unsupported calendar");
            return Reflect.construct(Target, args);
          },
        });
      } else {
        const original = Intl.DateTimeFormat.prototype.formatToParts;
        Intl.DateTimeFormat.prototype.formatToParts = function (date) {
          return original.call(this, date).map((part) => part.type === "month"
            ? { ...part, value: part.value.padStart(2, "0") } : part);
        };
      }
      Object.defineProperty(String.prototype, "replaceAll", { value: undefined });
      Object.defineProperty(Array.prototype, "at", { value: undefined });
    }, mode);
    await page.goto("/");
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await page.goto("/timeline");
    await expect(page.getByRole("contentinfo")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const failure of ["download", "runtime", "render"] as const) {
  test(`启动失败时展示诊断而非白屏：${failure}`, async ({ page }) => {
    if (failure === "render") {
      // Force an error during App rendering after the module has loaded.
      await page.addInitScript(() => {
        window.matchMedia = () => { throw new Error("synthetic-private-error"); };
      });
    } else {
      await page.route(/\/(?:assets\/index-[^/]+\.js|src\/main\.tsx)(?:\?.*)?$/, (route) =>
        failure === "download" ? route.abort() : route.fulfill({
          contentType: "application/javascript",
          body: 'throw new Error("synthetic-private-error")',
        }));
    }
    await page.goto("/");
    await expect(page.locator("#startup-code")).toContainText(
      failure === "download" ? "启动脚本下载失败" : "启动脚本运行失败",
    );
    await expect(page.locator("#startup-browser")).not.toBeEmpty();
    await expect(page.locator("#startup-status")).not.toContainText("synthetic-private-error");
  });
}
