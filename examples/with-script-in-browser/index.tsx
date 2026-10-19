import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@setsquare/setsquare/index.css";

import type * as TSetsquare from "@setsquare/setsquare";

import App from "./components/ExampleApp";

declare global {
  interface Window {
    SetsquareLib: typeof TSetsquare;
  }
}

const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
const { Setsquare } = window.SetsquareLib;
root.render(
  <StrictMode>
    <App
      appTitle={"Setsquare Example"}
      useCustom={(api: any, args?: any[]) => {}}
      setsquareLib={window.SetsquareLib}
    >
      <Setsquare />
    </App>
  </StrictMode>,
);
