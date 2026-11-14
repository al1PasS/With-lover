import { expect, test } from "../frontend/node_modules/@playwright/test/index";

test.use({
  baseURL: "http://127.0.0.1:5174",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

test("loads a memory before requesting the timeline and can cancel the detail", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let listRequests = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/memories/older-memory") {
      await pending;
      return route.fulfill({
        json: {
          id: "older-memory",
          title: "较早的回忆",
          body: "测试正文",
          tag: "烟火日常",
        },
      });
    }
    if (path === "/memories") {
      listRequests++;
      return route.fulfill({ json: [] });
    }
    const responses: Record<string, unknown> = {
      "/auth/me": { name: "当前成员", role: "MEMBER" },
      "/public/privacy": { mode: "PRIVATE" },
      "/auth/members": [],
      "/music": { selectedTrackId: null, tracks: [], revision: 0 },
      "/activities": { items: [], unread: 0, latestId: 0, nextCursor: null },
    };
    return route.fulfill({ json: responses[path] ?? [] });
  });
  try {
    await page.goto("/timeline?activity=older-memory");
    await expect(
      page.getByRole("dialog", { name: "正在打开回忆…" }),
    ).toBeVisible();
    expect(listRequests).toBe(0);
    await page.getByRole("button", { name: "关闭回忆" }).click();
    await expect(page).toHaveURL(/\/timeline$/);
    await expect.poll(() => listRequests).toBe(1);
    release();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    release();
  }
});
test.skip(
  process.env.ALBUM_ACTIVITY_UI_TEST !== "true",
  "requires a real-mode frontend on 5174 and synthetic API responses",
);

test("opens the affected photos before read acknowledgement and uses the full cover source", async ({
  page,
}) => {
  const albumId = "fixture";
  const photos = ["cover", "a", "b", "c"].map((id) => {
    const src = `/api/v1/albums/${albumId}/photos/${id}`;
    return {
      id,
      src,
      thumbnail: src + "?thumbnail=true",
      note: "",
      date: "2026-11-14",
    };
  });
  const album = {
    id: albumId,
    title: "测试相册",
    description: "",
    category: "event",
    date: "2026-11-14",
    coverId: "cover",
    cover: photos[0],
    photoCount: photos.length,
  };
  const base = {
    actor: "另一位成员",
    mine: false,
    module: "albums",
    targetId: albumId,
    action: "updated",
    title: album.title,
    route: `/albums/${albumId}`,
    createdAt: "2026-11-14T13:01:00Z",
    read: false,
    deleted: false,
  };
  const items = [
    {
      ...base,
      id: 3,
      summary: "更换了相册封面",
      photoUpdate: { kind: "cover", photoIds: ["cover"] },
    },
    {
      ...base,
      id: 2,
      summary: "添加了 1 张照片",
      photoUpdate: { kind: "added", photoIds: ["c"] },
    },
    {
      ...base,
      id: 1,
      summary: "添加了 3 张照片",
      photoUpdate: { kind: "added", photoIds: ["a", "b", "removed"] },
    },
  ];
  let unblock!: () => void;
  const pendingRead = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const marked: number[] = [];
  const requestedMedia: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice("/api/v1".length);
    if (path === "/activities/read") {
      await pendingRead;
      marked.push(...route.request().postDataJSON().ids);
      return route.fulfill({ status: 204 });
    }
    if (path === "/activities")
      return route.fulfill({
        json: {
          items: items.map((item) => ({
            ...item,
            read: marked.includes(item.id),
          })),
          unread: items.length - marked.length,
          latestId: 3,
          nextCursor: null,
        },
      });
    if (path.includes("/photos/")) {
      requestedMedia.push(path + url.search);
      return route.fulfill({
        status: 302,
        headers: { location: "/images/cover.webp" },
      });
    }
    const responses: Record<string, unknown> = {
      "/auth/me": { name: "当前成员", role: "MEMBER" },
      "/auth/csrf": { token: "test", headerName: "X-CSRF-TOKEN" },
      "/public/privacy": { mode: "PRIVATE" },
      "/auth/members": [],
      "/music": { selectedTrackId: null, tracks: [], revision: 0 },
      "/albums": [album],
      [`/albums/${albumId}`]: { album, photos },
    };
    return route.fulfill({ json: responses[path] ?? [] });
  });
  try {
    await page.goto("/albums");
    const image = page.getByRole("link", { name: /测试相册/ }).locator("img");
    await expect(image).toHaveAttribute("src", photos[0].src);
    await expect
      .poll(() => requestedMedia)
      .toContain(`/albums/${albumId}/photos/cover`);
    expect(requestedMedia).not.toContain(
      `/albums/${albumId}/photos/cover?thumbnail=true`,
    );
    await page.getByRole("button", { name: "最近更新，3 条未读" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /添加了 4 张照片/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "这次添加的照片" }),
    ).toBeVisible();
    await expect(page.getByText("1 张照片已移出相册。")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "相册照片" }).getByRole("button"),
    ).toHaveCount(3);
    await expect(page.locator("#activity-cover")).toHaveCount(0);
    expect(marked).toEqual([]);
    await page.getByRole("button", { name: "查看第 1 张照片" }).click();
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveText(
      "照片 1 / 3",
    );
    await page.getByRole("button", { name: "下一张照片" }).click();
    await expect(page.getByRole("dialog").locator("img")).toHaveAttribute(
      "src",
      photos[2].src,
    );
    await page.getByRole("button", { name: "关闭照片" }).click();
    await page.getByRole("link", { name: "查看全部照片" }).click();
    await expect(
      page.getByRole("region", { name: "相册照片" }).getByRole("button"),
    ).toHaveCount(4);
    unblock();
    await expect(
      page.getByRole("button", { name: "最近更新，1 条未读" }),
    ).toBeVisible();
    expect(marked).toEqual([2, 1]);
    await page.getByRole("button", { name: "最近更新，1 条未读" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /更换了相册封面/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "这次设置的封面" }),
    ).toBeVisible();
    await expect(page.locator("#activity-cover")).toBeVisible();
  } finally {
    unblock();
  }
});
