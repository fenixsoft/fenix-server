#!/usr/bin/env node
// =============================================================================
// tests/e2e/mock-proxy.mjs
//
// 本地 HTTP 代理桩 —— E2E 外部代理的"替身"。
//
// 角色（design.md §Decisions.3）：E2E 中 TunnelManager 的 clientProxy 指向
// 本桩；needs_proxy 任务执行时，服务器侧 127.0.0.1:<隧道端口> 的请求经反向
// 隧道送达本桩。桩记录收到的 CONNECT / absolute-URI GET，从而证明这些任务
// "确实经过隧道出网"。断言以"请求出现在桩记录"为准，不依赖海外真实可达。
//
// 功能：
//   - HTTP 代理转发（absolute-URI 请求）与 HTTPS CONNECT（隧道）转发
//   - 记录所有请求（方法 / 目标 / 时间）到内存
//   - 查询接口：
//       GET /__records        → 返回全部记录（JSON）
//       GET /__records/find?host=github.com  → 过滤记录（JSON）
//       POST /__records/clear → 清空记录
//   - 转发失败时仍向 caller 报告失败，但不中断（日志可见）
//
// 用法：
//   node tests/e2e/mock-proxy.mjs [port]
//   默认监听 0.0.0.0:8899；可用 MOCK_PROXY_PORT 环境变量覆盖。
// =============================================================================

import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.argv[2] ?? process.env.MOCK_PROXY_PORT ?? 8899);

/** @type {Array<{method: string, host?: string, port?: number, url: string, time: string}>} */
const records = [];

// ---------------------------------------------------------------------------
//  HTTP 代理转发 + 查询接口
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  // 查询接口（本机直连，非代理请求）
  if (req.url.startsWith('/__records')) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__records' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(records, null, 2));
      return;
    }
    if (url.pathname === '/__records/find' && req.method === 'GET') {
      const host = url.searchParams.get('host');
      const filtered = host
        ? records.filter((r) => (r.host ?? '').includes(host))
        : records;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(filtered, null, 2));
      return;
    }
    if (url.pathname === '/__records/clear' && req.method === 'POST') {
      records.length = 0;
      res.end('ok');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
    return;
  }

  // HTTP 代理请求：绝对 URI（如 GET http://example.com/path）
  let target;
  try {
    target = new URL(req.url);
    if (!/^https?:$/.test(target.protocol)) throw new Error(`unsupported scheme: ${target.protocol}`);
  } catch {
    res.statusCode = 400;
    res.end(`bad proxy request: ${req.url}`);
    return;
  }

  record('GET', `${target.hostname}:${target.port || 80}`, req.url);

  // 转发到目标
  const upstream = http.request(
    req.url,
    {
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    console.error(`[mock-proxy] upstream error: ${err.message}`);
    try {
      if (!res.headersSent) { res.statusCode = 502; res.end(`upstream error: ${err.message}`); }
      else res.destroy();
    } catch { /* 已关闭 */ }
  });
  upstream.on('close', () => {
    try { res.destroy(); } catch { /* 已关闭 */ }
  });
  req.on('error', () => {});
  res.on('close', () => {
    try { upstream.destroy(); } catch { /* 已关闭 */ }
  });
  try {
    req.pipe(upstream);
  } catch { /* 已关闭 */ }
});

// 兜底：未捕获异常不终止进程（代理桩可记录，测试仍能继续）
process.on('uncaughtException', (err) => {
  console.error(`[mock-proxy] uncaughtException: ${err?.stack ?? err}`);
});
process.on('unhandledRejection', (err) => {
  console.error(`[mock-proxy] unhandledRejection: ${err instanceof Error ? err.message : String(err)}`);
});

// ---------------------------------------------------------------------------
//  HTTPS CONNECT 隧道转发
// ---------------------------------------------------------------------------

server.on('connect', (req, clientSocket, head) => {
  // 解析 host:port；缺省 443；格式异常时兜底（不崩溃）
  const parts = String(req.url ?? '').split(':');
  const host = parts[0] || '';
  const port = Number(parts[1]) || 443;
  record('CONNECT', `${host}:${port}`, req.url);

  if (!host) {
    clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  let upstream;
  try {
    upstream = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n', () => {
        if (head && head.length > 0) {
          try { upstream.write(head); } catch { /* 连接已关 */ }
        }
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
    });
  } catch (err) {
    clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  upstream.on('error', (err) => {
    console.error(`[mock-proxy] CONNECT error ${host}:${port}: ${err.message}`);
    try {
      clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${err.message}`);
    } catch { /* 已关闭 */ }
  });
  upstream.on('close', () => {
    try { clientSocket.destroy(); } catch { /* 已关闭 */ }
  });
  clientSocket.on('error', () => {});
  clientSocket.on('close', () => {
    try { upstream.destroy(); } catch { /* 已关闭 */ }
  });
});

// ---------------------------------------------------------------------------
//  辅助
// ---------------------------------------------------------------------------

function record(method, host, url) {
  records.push({ method, host, url, time: new Date().toISOString() });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-proxy] listening on 0.0.0.0:${PORT}`);
});

// 优雅退出
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}