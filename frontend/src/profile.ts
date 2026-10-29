import type { Anniversary } from "./types";
import { dayDiff, nextAnniversary, nextLunarBirthday, today } from "./dates";

// User-provided dates. Birthday years are intentionally not inferred.
export const couple = {
  male: "杰杰",
  female: "雯晴",
  togetherSince: "2026-09-12",
};
export const personalAnniversaries: Anniversary[] = [
  {
    id: "first-chat",
    title: "第一次聊天",
    date: "2026-05-13",
    annual: false,
  },
  {
    id: "first-meeting",
    title: "第一次见面",
    date: "2026-06-19",
    annual: false,
  },
  { id: "together", title: "确认关系", date: "2026-09-12", annual: false },
  {
    id: "wenqing-lunar-birthday",
    title: "雯晴的生日",
    date: nextLunarBirthday(7, 8),
    annual: true,
    lunar: { month: 7, day: 8 },
    dateLabel: "农历七月初八",
  },
  {
    id: "jiejie-solar-birthday",
    title: "杰杰的生日（公历）",
    date: nextAnniversary("2000-01-30"),
    annual: true,
    dateLabel: "公历 1 月 30 日",
  },
  {
    id: "jiejie-lunar-birthday",
    title: "杰杰的生日（农历）",
    date: nextLunarBirthday(12, 28),
    annual: true,
    lunar: { month: 12, day: 28 },
    dateLabel: "农历腊月廿八",
  },
];
export function occurrence(a: Anniversary, now = today()) {
  return a.lunar
    ? nextLunarBirthday(a.lunar.month, a.lunar.day, now)
    : a.annual
      ? nextAnniversary(a.date, now)
      : a.date;
}
export function anniversaryLabel(a: Anniversary) {
  if (a.dateLabel) return a.dateLabel;
  if (a.lunar) return `农历${lunarMonthName(a.lunar.month)}月${lunarDayName(a.lunar.day)}`;
  const [y, m, d] = a.date.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}
function lunarMonthName(month: number) {
  return ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"][month - 1] || String(month);
}
function lunarDayName(day: number) {
  if (day <= 10) return `初${["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][day - 1]}`;
  if (day < 20) return `十${["一", "二", "三", "四", "五", "六", "七", "八", "九"][day - 11] || ""}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${["一", "二", "三", "四", "五", "六", "七", "八", "九"][day - 21] || ""}`;
  return "三十";
}
/** 每年重复的纪念日（如生日）倒计时；过去的一次性日子显示已过多少天。 */
export function anniversaryDays(a: Anniversary, now = today()) {
  const days = dayDiff(now, occurrence(a, now));
  if (days >= 0) return { kind: "countdown" as const, days };
  return { kind: "elapsed" as const, days: dayDiff(a.date, now) };
}
