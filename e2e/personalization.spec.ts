import {test,expect} from '../frontend/node_modules/@playwright/test/index';

test("the compact cover picker is keyboard and pointer accessible for members", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/");
  const picker = page.getByLabel("更换首页封面", { exact: true });
  await expect(picker).toHaveCount(0);
  await page.getByRole("button", { name: "进入我们的小世界" }).click();
  await page.getByRole("button", { name: "进入示例空间", exact: true }).click();

  const icon = page.locator(".photo-caption .cover-change-icon");
  await expect(icon).toHaveCSS("width", "28px");
  await expect(picker).toHaveCSS("width", "44px");
  await expect(picker).toHaveCSS("height", "44px");
  await picker.focus();
  await expect(icon).toHaveCSS("outline-style", "solid");
  const [keyboardPicker] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Enter"),
  ]);
  await keyboardPicker.setFiles([]);

  await page.setViewportSize({ width: 375, height: 812 });
  const [pointerPicker] = await Promise.all([
    page.waitForEvent("filechooser"),
    picker.click(),
  ]);
  const png = await page.evaluate(() => document.createElement("canvas").toDataURL("image/png"));
  await pointerPicker.setFiles({
    name: "synthetic-cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(png.split(",")[1], "base64"),
  });
  await expect(page.getByRole("status").filter({ hasText: "新的封面已经换好啦" })).toBeVisible();
  await expect(page.getByRole("img", { name: "我们的封面照片" })).toHaveAttribute("src", /^data:image\//);
});

test("home petals follow the scene pause control and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  await page.goto("/");
  const petals = page.locator(".castle-petal:visible");
  await expect(petals).toHaveCount(6);
  const petal = petals.first();
  await expect(petal).toHaveCSS("animation-name", "castle-petal-fall");
  await expect(petal).toHaveCSS("pointer-events", "none");
  await page.getByRole("button", { name: "暂停首页动效" }).click();
  await expect(petal).toHaveCSS("animation-play-state", "paused");
  await page.getByRole("button", { name: "播放首页动效" }).click();
  await expect(petal).toHaveCSS("animation-play-state", "running");

  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(petals).toHaveCount(9);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(petals).toHaveCount(0);
  await expect(page.getByRole("button", { name: "暂停首页动效" })).toBeHidden();
});

test('personal dates and visible mobile add buttons',async({page})=>{
 await page.setViewportSize({width:375,height:812});
 await page.goto('/');
 await expect(page.locator('.couple-label')).toContainText('雯晴');
 await expect(page.locator('.couple-label')).toContainText('杰杰');
 await expect(page.locator('.day-counter')).toHaveCount(0);
 await page.getByRole('button',{name:'进入我们的小世界'}).click();
 await expect(page.getByLabel('账户',{exact:true})).toHaveValue('杰杰');
 await page.getByRole('button',{name:'进入示例空间',exact:true}).click();
 for(const [label, action] of [['时光','新增回忆'],['足迹','上传长卷']] as const){
   await page.getByRole('navigation',{name:'手机导航'}).getByRole('link',{name:label}).click();
   const add=page.locator('.page-heading > .primary');
   await expect(add).toBeVisible();
   await expect(add).toContainText(action);
   const box=await add.locator('svg').boundingBox();
   expect(box?.width).toBeGreaterThanOrEqual(20);expect(box?.height).toBeGreaterThanOrEqual(20);
   await add.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 }
 await page.getByRole('navigation',{name:'手机导航'}).getByRole('link',{name:'相册'}).click();
 await expect(page.getByRole('button',{name:'事件相册'})).toBeVisible();
 await expect(page.getByRole('button',{name:'事物相册'})).toBeVisible();
 await expect(page.locator('.album-collection-wall > a')).toHaveCount(0);
 await expect(page.getByText('这一类还没有相册，先新建一本吧。')).toBeVisible();
 await page.getByRole('button',{name:'新建相册'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByLabel('相册名称')).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('navigation',{name:'手机导航'}).getByRole('link',{name:'时光'}).click();
 await page.screenshot({path:test.info().outputPath('mobile-add-fixed.png'),animations:'disabled'});
 await page.goto('/anniversaries');
 for(const text of ['2026 年 5 月 13 日','2026 年 6 月 19 日','2026 年 9 月 12 日','农历七月初八','公历 1 月 30 日','农历腊月廿八'])await expect(page.getByText(text,{exact:false})).toBeVisible();
 await expect(page.locator('.anniv-days').first()).toContainText('已经');
 await expect(page.locator('.anniv-days').last()).toContainText('还有');

 await page.getByRole('button',{name:'新增纪念日'}).click();
 await page.getByLabel('纪念日名称').fill('一起看第一场电影');
 await page.getByLabel('日期',{exact:true}).fill('2026-10-20');
 await page.getByRole('button',{name:'保存纪念日'}).click();
 await expect(page.getByText('一起看第一场电影')).toBeVisible();
 await page.getByRole('button',{name:'编辑一起看第一场电影'}).click();
 await page.getByLabel('纪念日名称').fill('一起看电影');
 await page.getByRole('button',{name:'保存修改'}).click();
 await expect(page.getByText('一起看电影')).toBeVisible();
 await page.getByRole('button',{name:'上移一起看电影'}).click();
 await expect(page.locator('.anniversary-grid .anniversary-paper').nth(5)).toContainText('一起看电影');
 page.once('dialog', dialog => dialog.accept());
 await page.getByRole('button',{name:'删除一起看电影'}).click();
 await expect(page.getByText('一起看电影')).toHaveCount(0);
});
