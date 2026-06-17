import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
  };
  return storage;
})();

try {
  Object.defineProperty(window, "localStorage", {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
} catch (e) {
  // ignore if window is not available
}

vi.stubGlobal("localStorage", mockLocalStorage);

vi.stubGlobal("confirm", () => true);

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
