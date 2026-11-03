import "../src/test-utils";

it("compares every point to the requested decimal precision", () => {
  expect([[0.009, -0.009]]).toCloselyEqualPoints([[0, 0]]);
  expect([[0.01, 0]]).not.toCloselyEqualPoints([[0, 0]]);
  expect([[99, 99]]).not.toCloselyEqualPoints([[0, 0]]);
  expect([
    [0, 0],
    [1, 1],
  ]).not.toCloselyEqualPoints([[0, 0]]);
  expect([]).not.toCloselyEqualPoints([[0, 0]]);
  expect([[0.9, 0]]).toCloselyEqualPoints([[0, 0]], 0);
  expect([[0.001, 0]]).not.toCloselyEqualPoints([[0, 0]], 3);
});
