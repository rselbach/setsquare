import { render, screen } from "@testing-library/react";

import { TopErrorBoundary } from "../components/TopErrorBoundary";

const Broken = () => {
  throw new Error("Chang broke the study room");
};

const renderBroken = () =>
  render(
    <TopErrorBoundary>
      <Broken />
    </TopErrorBoundary>,
  );

describe("TopErrorBoundary", () => {
  beforeEach(() => {
    // React reports the error it caught
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete (window as any).isTauri;
    vi.restoreAllMocks();
  });

  it("offers the way back to the drawings on the web", () => {
    renderBroken();

    expect(
      screen.getByRole("button", { name: "reloading the page" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "back to your drawings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "clearing the canvas" })).toBe(
      null,
    );
  });

  it("offers to clear the scene in the desktop app", () => {
    Object.assign(window, { isTauri: true });

    renderBroken();

    expect(
      screen.getByRole("button", { name: "clearing the canvas" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "back to your drawings" }),
    ).toBe(null);
  });
});
