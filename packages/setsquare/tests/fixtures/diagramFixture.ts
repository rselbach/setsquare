import { VERSIONS } from "@setsquare/common";

import type {
  SetsquareElement,
  NonDeletedSetsquareElement,
} from "@setsquare/element/types";

import {
  diamondFixture,
  ellipseFixture,
  rectangleFixture,
} from "./elementFixture";

export const diagramFixture = {
  type: "setsquare",
  version: VERSIONS.setsquare,
  source: "https://greendale.edu",
  elements: [diamondFixture, ellipseFixture, rectangleFixture],
  appState: {
    viewBackgroundColor: "#ffffff",
    gridModeEnabled: false,
  },
  files: {},
};

export const diagramFactory = ({
  overrides = {},
  elementOverrides = {} as Partial<SetsquareElement>,
} = {}) => ({
  ...diagramFixture,
  elements: [
    {
      ...diamondFixture,
      ...elementOverrides,
      isDeleted: elementOverrides.isDeleted ?? false,
    } as NonDeletedSetsquareElement,
    {
      ...ellipseFixture,
      ...elementOverrides,
      isDeleted: elementOverrides.isDeleted ?? false,
    } as NonDeletedSetsquareElement,
    {
      ...rectangleFixture,
      ...elementOverrides,
      isDeleted: elementOverrides.isDeleted ?? false,
    } as NonDeletedSetsquareElement,
  ],
  ...overrides,
});

export default diagramFixture;
