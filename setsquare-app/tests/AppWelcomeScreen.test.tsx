import { Setsquare } from "@setsquare/setsquare";
import { render } from "@setsquare/setsquare/tests/test-utils";

import { AppWelcomeScreen } from "../components/AppWelcomeScreen";

const menuHint = () =>
  document.querySelector(".welcome-screen-decor-hint--menu");

describe("AppWelcomeScreen", () => {
  afterEach(() => {
    delete (window as any).isTauri;
  });

  it("points at the main menu on the web", async () => {
    await render(
      <Setsquare>
        <AppWelcomeScreen />
      </Setsquare>,
    );

    expect(menuHint()).not.toBeNull();
  });

  it("doesn't point at a main menu the desktop app hides", async () => {
    Object.assign(window, { isTauri: true });

    await render(
      <Setsquare UIOptions={{ mainMenu: false }}>
        <AppWelcomeScreen />
      </Setsquare>,
    );

    expect(menuHint()).toBeNull();
  });
});
