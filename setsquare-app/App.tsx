import { isTauri } from "@tauri-apps/api/core";
import { SetsquareAPIProvider } from "@setsquare/setsquare";
import polyfill from "@setsquare/setsquare/polyfill";

import { Provider, appJotaiStore } from "./app-jotai";
import { TopErrorBoundary } from "./components/TopErrorBoundary";
import { SingleSceneRoot } from "./desktop/SingleSceneRoot";
import { WebRoot } from "./web/WebRoot";

import "./index.scss";

polyfill();

window.SETSQUARE_THROTTLE_RENDER = true;

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const SetsquareApp = () => {
  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  const app = isSelfEmbedding ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        height: "100%",
      }}
    >
      <h1>I'm not a pretzel!</h1>
    </div>
  ) : isTauri() ? (
    // the desktop app keeps one scene, saved to a file or locally
    <SingleSceneRoot />
  ) : (
    <WebRoot />
  );

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <SetsquareAPIProvider>{app}</SetsquareAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default SetsquareApp;
