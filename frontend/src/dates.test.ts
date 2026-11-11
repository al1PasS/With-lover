import { describe, it, expect, vi, afterEach } from "vitest";
import { dayDiff, nextAnniversary, today } from "./dates";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("北京时间日期语义", () => {
  it("北京时间午夜切日，始终返回 ISO 日期", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T15:59:59Z"));
    expect(today()).toBe("2026-12-31");
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    expect(today()).toBe("2027-01-01");
    expect(nextLunarBirthday(12, 28)).toBe("2027-02-04");
  });
  it("当天累计为0，跨年按自然日计数", () => {
    expect(dayDiff("2025-12-31", "2025-12-31")).toBe(0);
    expect(dayDiff("2025-12-31", "2026-01-01")).toBe(1);
  });
  it("未来日期保持负数，倒计时不会误算为过去", () =>
    expect(dayDiff("2026-12-24", "2026-10-02")).toBe(-83));
  it("闰日周年在平年落在2月末", () =>
    expect(nextAnniversary("2024-02-29", "2025-02-01")).toBe("2025-02-28"));
  it("当天的周年保留当天", () =>
    expect(nextAnniversary("2020-05-20", "2026-05-20")).toBe("2026-05-20"));
  it("已过周年滚动到下一年", () =>
    expect(nextAnniversary("2020-05-20", "2026-05-21")).toBe("2027-05-20"));
});

import { nextLunarBirthday } from "./dates";
describe("农历生日逐年换算", () => {
  it("不需要浏览器提供农历或 formatToParts 接口", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(() => {
      throw new Error("模拟旧安卓缺少日历接口");
    });
    expect(nextLunarBirthday(7, 8, "2026-01-01")).toBe("2026-08-20");
    expect(nextLunarBirthday(12, 28, "2026-01-01")).toBe("2026-02-15");
  });
  it("常规六月生日不会在闰六月重复纪念", () => {
    expect(nextLunarBirthday(6, 1, "2025-06-25")).toBe("2025-06-25");
    expect(nextLunarBirthday(6, 1, "2025-06-26")).toBe("2026-07-14");
  });
  it("拒绝无效农历月日", () => {
    expect(() => nextLunarBirthday(13, 1, "2026-01-01")).toThrow("无效的农历生日");
    expect(() => nextLunarBirthday(7, 31, "2026-01-01")).toThrow("无效的农历生日");
  });
  it("2026年七月初八对应8月20日，当天不跳到下一年", () => {
    expect(nextLunarBirthday(7, 8, "2026-01-01")).toBe("2026-08-20");
    expect(nextLunarBirthday(7, 8, "2026-08-20")).toBe("2026-08-20");
  });
  it("腊月生日跨越公历年，不固定成公历1月30日", () => {
    expect(nextLunarBirthday(12, 28, "2026-01-01")).toBe("2026-02-15");
  });
  it("生日过后寻找下一农历年度", () => {
    const next = nextLunarBirthday(7, 8, "2026-08-21");
    expect(next.startsWith("2027-")).toBe(true);
    expect(nextLunarBirthday(7, 8, next)).toBe(next);
  });
  it("确认关系当天为0天", () =>
    expect(dayDiff("2026-09-12", "2026-09-12")).toBe(0));
});
