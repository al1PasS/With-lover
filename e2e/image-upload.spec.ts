import { expect, test } from "../frontend/node_modules/@playwright/test/index";

test.use({
  baseURL: "http://127.0.0.1:5174",
  viewport: { width: 375, height: 812 },
});
test.skip(
  process.env.IMAGE_UPLOAD_REAL_TEST !== "true",
  "requires the production build behind Nginx with an isolated API and synthetic accounts",
);

// Synthetic 420 × 60 red/blue PNG encoded with macOS sips, with no personal metadata.
const heic = Buffer.from(
  "AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOVpcHJwAAAAxGlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAABpAAAADwAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcGh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAIkIBAQNwAAADALAAAAMAAAMAHqANiBBz3iHuRZVNwICBgCCiAAEACUQBwGFyyEBTJAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAeaWxvYwAAAABEAAABAAEAAAABAAABuQAAAFMAAAABbWRhdAAAAAAAAABjAAAATygBr6NvRoF8//ww3/+8L7L7kHz7Fv2elHtxUjOMirMFL/+YbmHpaXfy5ITpWBQfajkQSdDv0IAAAAMAaMA+bcX844qL/aLvA44c6sAADGg=",
  "base64",
);

function padHeif(size: number) {
  const data = Buffer.alloc(size);
  heic.copy(data);
  data.writeUInt32BE(size - heic.length, heic.length);
  data.write("free", heic.length + 4);
  return data;
}

test("HEIF is compressed before upload in every photo picker and the 10 MiB boundary is inclusive", async ({
  page,
}) => {
  const violations: string[] = [];
  const codecRequests: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content Security Policy|wasm-unsafe-eval/i.test(message.text())
    )
      violations.push(message.text());
  });
  page.on("request", (request) => {
    if (/heic-to-.*\.js|mozjpeg_enc-.*\.wasm/.test(request.url()))
      codecRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const fetch = window.fetch;
    window.fetch = (input, options) => {
      if (options?.body instanceof FormData) {
        const photo = options.body.get("files");
        if (photo instanceof File)
          document.documentElement.dataset.uploadedPhoto = `${photo.type}:${photo.size}`;
      }
      return fetch(input, options);
    };
  });
  await page.goto("/records");
  await page.getByRole("button", { name: "登录后再看" }).click();
  await page.getByLabel("账户").fill("activity-one");
  await page.getByLabel("密码").fill("shared-features-test-only");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();

  await page.goto("/albums");
  await page.getByRole("button", { name: "新建相册" }).click();
  await page.getByLabel("相册名称").fill(`HEIF 测试 ${Date.now()}`);
  await page.getByRole("button", { name: "创建并进入相册" }).click();
  const albumInput = page.getByLabel("批量添加照片");
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/albums\/[^/]+\/photos$/.test(response.url()),
  );
  const limit = 10 * 1024 * 1024;
  await albumInput.setInputFiles([
    {
      name: "boundary.heif",
      mimeType: "application/octet-stream",
      buffer: padHeif(limit),
    },
    { name: "over.heic", mimeType: "image/heic", buffer: padHeif(limit + 1) },
    {
      name: "broken.heic",
      mimeType: "image/heic",
      buffer: Buffer.from("invalid HEIC"),
    },
  ]);
  const uploaded = await upload;
  expect(uploaded.ok()).toBeTruthy();
  const submitted = await page
    .locator("html")
    .getAttribute("data-uploaded-photo");
  expect(submitted).toMatch(/^image\/jpeg:\d+$/);
  expect(Number(submitted?.split(":")[1])).toBeLessThan(50_000);
  expect(codecRequests.some((url) => url.includes("heic-to-"))).toBeTruthy();
  expect(
    codecRequests.some((url) => url.includes("mozjpeg_enc-")),
  ).toBeTruthy();
  await expect(
    page.getByText("已添加 1 张照片", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("单张照片不能超过 10 MB");
  await expect(page.getByRole("alert")).toContainText("1 张照片未能读取");
  const { photos } = await uploaded.json();
  const thumbnail = await page.request.get(photos[0].thumbnail);
  expect(thumbnail.headers()["content-type"]).toBe("image/jpeg");

  const file = { name: "camera.heic", mimeType: "image/heic", buffer: heic };
  await page.goto("/timeline");
  await page.getByRole("button", { name: "新增回忆" }).click();
  let editor = page.getByRole("dialog");
  await editor.getByLabel("给这一刻起个名字").fill("HEIC 测试照片");
  await editor.getByLabel("想记住的故事").fill("合成照片上传");
  await editor.locator('input[type="file"]').setInputFiles(file);
  await expect(
    editor.getByRole("img", { name: "待发布照片预览" }),
  ).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  const memory = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/memories"),
  );
  await editor.getByRole("button", { name: "收藏这一刻" }).click();
  expect((await memory).status()).toBe(201);

  await page.goto("/");
  const cover = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/api/v1/settings/cover"),
  );
  await page.locator('.cover-change input[type="file"]').setInputFiles(file);
  expect((await cover).ok()).toBeTruthy();
  const savedCover = await page.request.get("/api/v1/media/cover");
  expect(savedCover.headers()["content-type"]).toBe("image/jpeg");

  await page.goto("/places");
  await page.getByRole("button", { name: "上传长卷", exact: true }).click();
  editor = page.getByRole("dialog");
  await editor.getByLabel("城市名").fill("合成长卷");
  await editor.getByLabel("一句话说明").fill("HEIC 转码测试");
  await editor.locator('input[type="file"]').setInputFiles(file);
  await expect(
    editor.getByRole("img", { name: "城市长卷预览" }),
  ).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  const place = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/admin/places"),
  );
  await editor.getByRole("button", { name: "发布到足迹" }).click();
  expect((await place).status()).toBe(201);
  expect(violations).toEqual([]);
});
