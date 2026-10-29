import { describe, it, expect } from "vitest";
import { dayDiff, nextAnniversary } from "./dates";
describe("北京时间日期语义", () => {
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
