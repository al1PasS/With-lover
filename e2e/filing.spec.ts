import { test, expect } from "../frontend/node_modules/@playwright/test/index";

test("public footer shows the ICP filing link on desktop and mobile", async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/timeline", "/admin"]) {
      await page.goto(route);
      const filing = page.getByRole("contentinfo").getByRole("link", {
        name: "苏ICP备2026086858号-1",
        exact: true,
      });
      await filing.scrollIntoViewIfNeeded();
      await expect(filing).toBeVisible();
      await expect(filing).toHaveAttribute("href", "https://beian.miit.gov.cn/");
      await expect(filing).toHaveAttribute("target", "_blank");
      await expect(filing).toHaveAttribute("rel", "noopener noreferrer");
      await expect(filing).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const unobscured = await filing.evaluate((link) => {
        const rect = link.getBoundingClientRect();
        return link.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      });
      expect(unobscured).toBe(true);
    }
  }
});
