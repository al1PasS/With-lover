import { Lunar, LunarYear, Solar } from "lunar-typescript";

// Locale output varies across browser/ICU versions (en-CA may use MM/DD/YYYY).
// Date calculations require YYYY-MM-DD, regardless of the device's locale/timezone.
export const today = () =>
  new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
export const dayDiff = (from: string, to = today()) =>
  Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
      86400000,
  );
export function nextAnniversary(date: string, now = today()) {
  const [y, m, d] = date.split("-").map(Number);
  let year = Number(now.slice(0, 4));
  const candidate = (n: number) =>
    `${n}-${String(m).padStart(2, "0")}-${String(Math.min(d, new Date(Date.UTC(n, m, 0)).getUTCDate())).padStart(2, "0")}`;
  let result = candidate(year);
  if (result < now) result = candidate(++year);
  return result;
}

/** Birthday recurrence uses the regular lunar month, not a leap month. */
export function nextLunarBirthday(
  month: number,
  day: number,
  now = today(),
): string {
  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1 || day > 30) {
    throw new Error("无效的农历生日");
  }
  const [year, solarMonth, solarDay] = now.split("-").map(Number);
  const lunarYear = Solar.fromYmd(year, solarMonth, solarDay).getLunar().getYear();
  // Use bundled calendar calculations: Android WebViews may omit Chinese ICU
  // data or formatToParts. Positive lunar months exclude the leap month.
  for (let candidate = lunarYear; candidate < lunarYear + 8; candidate++) {
    const regularMonth = LunarYear.fromYear(candidate).getMonth(month);
    if (!regularMonth || regularMonth.getDayCount() < day) continue;
    const result = Lunar.fromYmd(candidate, month, day).getSolar().toYmd();
    if (result >= now) return result;
  }
  throw new Error("无法计算下一次农历生日");
}
