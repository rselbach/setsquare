import {
  formatRelativeTime,
  formatTimeAgo,
} from "../../workspace/formatRelativeTime";

// local time, so the calendar days don't depend on the machine's time zone
const NOW = new Date(2026, 9, 28, 15, 0).getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  const cases: Record<string, { time: number; want: string }> = {
    "says now for the last minute": { time: NOW - 20 * 1000, want: "now" },
    "says now for a time a little ahead": { time: NOW + MINUTE, want: "now" },
    "counts minutes within the hour": { time: NOW - 5 * MINUTE, want: "5m" },
    "counts hours within the day": { time: NOW - 3 * HOUR, want: "3h" },
    "counts hours into yesterday": { time: NOW - 23 * HOUR, want: "23h" },
    "names the weekday within the week": {
      time: new Date(2026, 9, 26, 9, 0).getTime(),
      want: "Mon",
    },
    "names the weekday six days back": {
      time: new Date(2026, 9, 22, 23, 0).getTime(),
      want: "Thu",
    },
    "gives the date a week back": {
      time: new Date(2026, 9, 21, 23, 0).getTime(),
      want: "Oct 21",
    },
    "gives the date earlier this year": {
      time: new Date(2026, 0, 12, 8, 0).getTime(),
      want: "Jan 12",
    },
    "gives the year of an earlier one": {
      time: new Date(2025, 9, 12, 8, 0).getTime(),
      want: "Oct 12, 2025",
    },
  };

  for (const [name, tc] of Object.entries(cases)) {
    it(name, () => {
      expect(formatRelativeTime(tc.time, NOW, "en")).toBe(tc.want);
    });
  }

  it("uses the locale's words", () => {
    expect(formatRelativeTime(NOW - 20 * 1000, NOW, "pt-BR")).toBe("agora");
    expect(
      formatRelativeTime(new Date(2026, 9, 26).getTime(), NOW, "pt-BR"),
    ).toBe("seg.");
  });
});

describe("formatTimeAgo", () => {
  const cases: Record<string, { time: number; want: string | null }> = {
    "has no words for the last minute": { time: NOW - 20 * 1000, want: null },
    "has none for a time a little ahead": { time: NOW + MINUTE, want: null },
    "counts minutes within the hour": {
      time: NOW - 5 * MINUTE,
      want: "5 minutes ago",
    },
    "counts hours within the day": {
      time: NOW - 3 * HOUR,
      want: "3 hours ago",
    },
    "says yesterday for a day": { time: NOW - 30 * HOUR, want: "yesterday" },
    "counts days after that": { time: NOW - 3 * DAY, want: "3 days ago" },
    "counts days up to the Trash's 30": {
      time: NOW - 29 * DAY - HOUR,
      want: "29 days ago",
    },
  };

  for (const [name, tc] of Object.entries(cases)) {
    it(name, () => {
      expect(formatTimeAgo(tc.time, NOW, "en")).toBe(tc.want);
    });
  }

  it("uses the locale's words", () => {
    expect(formatTimeAgo(NOW - 3 * DAY, NOW, "pt-BR")).toBe("há 3 dias");
  });
});
