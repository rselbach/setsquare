import { useEffect, useState } from "react";

// relative times move on even when nothing is saved
const CLOCK_TICK_MS = 60 * 1000;

/** The time, a minute at most behind, for showing how long ago things were. */
export const useNow = () => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(tick);
  }, []);
  return now;
};
