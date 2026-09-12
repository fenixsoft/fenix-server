/**
 * server/timing.ts
 *
 * 限时等待工具。关闭路径上多处需要「等一件事，但最多等 N 毫秒」，
 * 而这些等待都必须在结束时清掉定时器：残留的定时器会引用事件循环，
 * 让进程在关闭之后继续空等（表现为「退出慢」甚至「不退出」）。
 */

/**
 * 等待 `promise` 完成，最多 `ms` 毫秒。
 *
 * - 到点未完成 → 返回 false，调用方可继续（放弃等待）
 * - `promise` reject → 返回 true 并**吞掉**异常，关闭路径不应因此中断
 * - 无论哪种结果都会清理定时器
 */
export async function waitAtMost(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
