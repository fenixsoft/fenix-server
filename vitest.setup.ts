/**
 * vitest.setup.ts
 *
 * Global test setup: registers @testing-library/jest-dom matchers so
 * component tests can use toBeInTheDocument / toHaveStyle etc.
 */
import '@testing-library/jest-dom/vitest';

// jsdom 未实现 window.matchMedia —— antd 的 responsiveObserver（Steps/
// Layout/Grid 等使用）在组件挂载时会读取它。提供一个最小 stub 让组件测试
// （ExecutionSteps 等）在 jsdom 下可挂载。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
