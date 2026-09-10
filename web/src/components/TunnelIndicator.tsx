/**
 * web/src/components/TunnelIndicator.tsx
 *
 * Top-bar tunnel status indicator:
 *   - three-colour Tag by state (green open / grey closed / red error)
 *   - shows the bound remote port when open
 *   - 「测试」button sends tunnel-test; the result (outbound IP or failure
 *     reason) is shown in a Popover bubble (app-shell requirement).
 */
import { Badge, Button, Popover, Space, Tag, Typography } from 'antd';
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';

const { Text } = Typography;

export default function TunnelIndicator() {
  const tunnel = useAppStore((s) => s.tunnel);
  const tunnelTestResult = useAppStore((s) => s.tunnelTestResult);
  const requestTunnelTest = useAppStore((s) => s.requestTunnelTest);
  const openTunnel = useAppStore((s) => s.openTunnel);

  const open = tunnel?.open ?? false;

  const color = open ? 'success' : tunnel?.message ? 'error' : 'default';
  const label = open
    ? `隧道:${tunnel?.remotePort ?? '?'}`
    : tunnel?.message
      ? '隧道错误'
      : '隧道关闭';

  const testBubble = (
    <div style={{ maxWidth: 280 }}>
      {tunnelTestResult ? (
        tunnelTestResult.ip ? (
          <Text>出口 IP：<Text strong code>{tunnelTestResult.ip}</Text></Text>
        ) : (
          <Text type="danger">{tunnelTestResult.error ?? '测试失败'}</Text>
        )
      ) : (
        <Text type="secondary">点击「测试」获取出口 IP。</Text>
      )}
    </div>
  );

  return (
    <Space size={8}>
      <Popover content={testBubble} title="隧道连通性测试" trigger="click">
        <Tag color={color} icon={<ApiOutlined />} style={{ cursor: 'pointer' }}>
          {label}
        </Tag>
      </Popover>
      {open ? (
        <Button size="small" icon={<ReloadOutlined />} onClick={requestTunnelTest}>
          测试
        </Button>
      ) : (
        <Button size="small" onClick={openTunnel} disabled={!tunnel?.message && open === false && tunnel === null}>
          开启隧道
        </Button>
      )}
    </Space>
  );
}
