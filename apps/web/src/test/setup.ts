import "@testing-library/jest-dom/vitest";

class ResizeObserverMock implements ResizeObserver {
  public disconnect() {}
  public observe() {}
  public unobserve() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: () => undefined,
});
