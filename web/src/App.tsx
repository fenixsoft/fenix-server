/**
 * web/src/App.tsx
 *
 * Application shell — top bar + status bar + view routing.
 *
 *   - When disconnected: show ConnectionView (fullscreen).
 *   - When connected: show TaskView with the header and status bar around it.
 *
 * Layout (design doc §8 ASCII):
 *
 * ┌─ 顶栏：root@1.2.3.4 ●已连接 │ 隧道:… → :7890 ●已连通 [测试] │ [断开] ─┐
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │  [TaskView: Toolbar │ Tabs]                                            │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ 状态栏：SSH ●已连接 │ 隧道 ●开启 │ 当前: OhMyZsh │ 耗时 04:12         │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Tag, Button, Typography, Space } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { useAppStore } from './stores/appStore';
import { wsClient } from './wsClient';
import ConnectionView from './views/ConnectionView';
import TaskView from './views/TaskView';
import TunnelIndicator from './components/TunnelIndicator';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

// ---------------------------------------------------------------------------
//  Elapsed-time hook
// ---------------------------------------------------------------------------

function useElapsed(runStartedAt: number | null, running: boolean): string {
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [running]);

  if (!runStartedAt) return '00:00';
  const diff = Math.max(0, Math.floor((now - runStartedAt) / 1000));
  const m = String(Math.floor(diff / 60)).padStart(2, '0');
  const s = String(diff % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
//  App
// ---------------------------------------------------------------------------

export default function App() {
  const connected = useAppStore((s) => s.sshStatus);
  const host = useAppStore((s) => s.host);
  const username = useAppStore((s) => s.username);
  const port = useAppStore((s) => s.port);
  const tunnel = useAppStore((s) => s.tunnel);
  const currentTaskTitle = useAppStore((s) => s.currentTaskTitle);
  const runStartedAt = useAppStore((s) => s.runStartedAt);
  const taskStates = useAppStore((s) => s.taskStates);
  const disconnect = useAppStore((s) => s.disconnect);

  const running = Object.values(taskStates).includes('running');
  const elapsed = useElapsed(runStartedAt, running);

  // Establish the module-level wsClient subscriptions once.
  useEffect(() => {
    const unsub = wsClient.onMessage((msg) => {
      useAppStore.getState().applyServerMessage(msg);
    });
    return unsub;
  }, []);

  const ready = connected === 'ready';

  // -- Connection view (full screen)
  if (!ready) {
    return (
      <Layout style={{ height: '100vh' }}>
        <Content style={{ background: '#fafafa', overflow: 'auto' }}>
          <ConnectionView />
        </Content>
      </Layout>
    );
  }

  // -- Connected view: header + task view + status bar
  return (
    <Layout style={{ height: '100vh' }}>
      {/* ---- Header ---- */}
      <Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          height: 48,
          lineHeight: '48px',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={12}>
          <Tag color="blue">{username}@{host}:{port}</Tag>
          <Tag color="success">●已连接</Tag>
          <TunnelIndicator />
        </Space>
        <Button icon={<LogoutOutlined />} onClick={disconnect} size="small">
          断开
        </Button>
      </Header>

      {/* ---- Main content ---- */}
      <Content style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
        <TaskView />
      </Content>

      {/* ---- Status bar ---- */}
      <Footer
        style={{
          height: 28,
          lineHeight: '28px',
          padding: '0 16px',
          borderTop: '1px solid #f0f0f0',
          background: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 12,
        }}
      >
        <Space size={16}>
          <Text type="secondary">
            SSH <Tag color={ready ? 'success' : 'error'} style={{ marginLeft: 2 }}>{ready ? '●已连接' : '●未连接'}</Tag>
          </Text>
          <Text type="secondary">
            隧道 <Tag color={tunnel?.open ? 'success' : 'default'} style={{ marginLeft: 2 }}>{tunnel?.open ? '●开启' : '●关闭'}</Tag>
          </Text>
          {currentTaskTitle && (
            <Text type="secondary">当前: {currentTaskTitle}</Text>
          )}
          {running && <Text type="secondary">耗时 {elapsed}</Text>}
        </Space>
      </Footer>
    </Layout>
  );
}
