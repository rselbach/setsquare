const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// rounded, because a day that changes the clocks is an hour off
const calendarDaysBetween = (from: Date, to: Date) =>
  Math.round((startOfDay(to) - startOfDay(from)) / DAY);

const narrowUnit = (locale: string, unit: "minute" | "hour", value: number) =>
  new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "narrow",
  }).format(value);

/**
 * When something happened, as short as a list has room for and in the
 * locale's words: "now", then "5m" and "3h" within a day, the weekday within
 * a week, and the date after that, with its year when it isn't this one.
 */
export const formatRelativeTime = (
  time: number,
  now: number,
  locale: string,
) => {
  const elapsed = now - time;
  // a clock that's a little ahead makes the future recent too
  if (elapsed < MINUTE) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      0,
      "second",
    );
  }
  if (elapsed < HOUR) {
    return narrowUnit(locale, "minute", Math.floor(elapsed / MINUTE));
  }
  if (elapsed < DAY) {
    return narrowUnit(locale, "hour", Math.floor(elapsed / HOUR));
  }
  const then = new Date(time);
  const today = new Date(now);
  // a week back, the weekday would be today's
  if (calendarDaysBetween(then, today) < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(then);
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: then.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(then);
};
