import type { SetsquareTextContainer } from "./types";

export const originalContainerCache: {
  [id: SetsquareTextContainer["id"]]:
    | {
        height: SetsquareTextContainer["height"];
      }
    | undefined;
} = {};

export const updateOriginalContainerCache = (
  id: SetsquareTextContainer["id"],
  height: SetsquareTextContainer["height"],
) => {
  const data =
    originalContainerCache[id] || (originalContainerCache[id] = { height });
  data.height = height;
  return data;
};

export const resetOriginalContainerCache = (
  id: SetsquareTextContainer["id"],
) => {
  if (originalContainerCache[id]) {
    delete originalContainerCache[id];
  }
};

export const getOriginalContainerHeightFromCache = (
  id: SetsquareTextContainer["id"],
) => {
  return originalContainerCache[id]?.height ?? null;
};
