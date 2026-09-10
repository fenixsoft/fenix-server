import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@fenix/shared': path.resolve(__dirname, 'shared'),
      '@fenix/shared/': path.resolve(__dirname, 'shared/') + '/',
    },
  },
  test: {
    passWithNoTests: true,
    // 排除 .claude 下的并发 worktree 测试文件：验证/测试运行在主树，
    // 若不排除，vitest 会把 .claude/worktrees/<impl-*>/ 下同名测试一并收集，
    // 与主树测试并行连接同一测试容器、竞抢同一批端口，造成偶发 bind 冲突。
    exclude: ['**/.claude/**', '**/node_modules/**', '**/dist/**'],
  },
});
