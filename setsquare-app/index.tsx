import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

// must load before the editor, which checks for these browser APIs once
import "./desktop/fileSystem";
import "./desktop/launchQueue";
import SetsquareApp from "./App";

const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <SetsquareApp />
  </StrictMode>,
);
