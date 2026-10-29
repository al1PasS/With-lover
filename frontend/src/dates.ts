export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  const formatter = new Intl.DateTimeFormat("en-u-ca-chinese", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
  const start = Date.parse(now + "T04:00:00Z");
  for (let offset = 0; offset < 400; offset++) {
    const date = new Date(start + offset * 86400000);
    const parts = formatter.formatToParts(date);
    if (
      parts.find((p) => p.type === "month")?.value === String(month) &&
      parts.find((p) => p.type === "day")?.value === String(day)
    ) {
      return date.toISOString().slice(0, 10);
    }
  }
  throw new Error("无法计算下一次农历生日");
}
