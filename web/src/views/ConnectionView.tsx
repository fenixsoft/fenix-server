/**
 * web/src/views/ConnectionView.tsx
 *
 * Connection view — shown when the app is not connected.
 *
 *   - Server management: pick a previously-saved server (from the local
 *     servers list) or enter a new one (name/host/port/username/password).
 *   - "记住密码" switch carries a plaintext-storage risk notice.
 *   - Client-side proxy address (host:port) with format validation.
 *   - Task manifest source: built-in default checklist or a custom YAML
 *     (upload or paste). Custom manifests are validated client-side through
 *     the shared zod schema before connecting.
 *   - Connect action: shows a connecting state; failures surface as a
 *     categorised error (auth failure / unreachable / timeout).
 */
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { CloudServerOutlined, PlusOutlined } from '@ant-design/icons';
import { useAppStore, type PersistedServer } from '../stores/appStore';

const { Text } = Typography;

/** Host / IP literal check used for the hostname field. */
const HOST_PATTERN = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
/** host:port proxy format, e.g. "127.0.0.1:7890". */
const PROXY_PATTERN = /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$|^[a-zA-Z0-9.-]+:\d{1,5}$/;

interface ConnectionFormValues {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  rememberPassword?: boolean;
}

export default function ConnectionView() {
  const servers = useAppStore((s) => s.servers);
  const sshStatus = useAppStore((s) => s.sshStatus);
  const clientProxy = useAppStore((s) => s.clientProxy);
  const lastError = useAppStore((s) => s.lastError);
  const addServer = useAppStore((s) => s.addServer);
  const removeServer = useAppStore((s) => s.removeServer);
  const setClientProxy = useAppStore((s) => s.setClientProxy);
  const connect = useAppStore((s) => s.connect);
  const loadBuiltinManifest = useAppStore((s) => s.loadBuiltinManifest);
  const loadCustomManifest = useAppStore((s) => s.loadCustomManifest);

  const [form] = Form.useForm<ConnectionFormValues>();
  const [selectedServerName, setSelectedServerName] = useState<string | undefined>(undefined);
  const [manifestSource, setManifestSource] = useState<'builtin' | 'custom'>('builtin');
  const [customYaml, setCustomYaml] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connecting = sshStatus === 'connecting';

  const selectedServer = useMemo(
    () => servers.find((s) => s.name === selectedServerName),
    [servers, selectedServerName],
  );

  // -- helpers --------------------------------------------------------------

  /** Categorise a connection failure into a user-actionable error. */
  function categorizeError(message: string): { kind: 'auth' | 'unreachable' | 'timeout' | 'other'; text: string } {
    if (/认证|密码|AUTH/i.test(message)) {
      return { kind: 'auth', text: '认证失败：请检查用户名与密码是否正确。' };
    }
    if (/超时|timeout/i.test(message)) {
      return { kind: 'timeout', text: '连接超时：目标服务器无响应，请检查网络或防火墙。' };
    }
    if (/无法连接|拒绝|UNREACHABLE|ECONN|网络/i.test(message)) {
      return { kind: 'unreachable', text: '网络不可达：无法连接到目标服务器。' };
    }
    return { kind: 'other', text: message };
  }

  function handleConnect(values: ConnectionFormValues): void {
    setFormError(null);
    if (manifestSource === 'custom') {
      const result = loadCustomManifest(customYaml);
      if (!result.ok) {
        setFormError(result.error ?? '自定义清单解析失败');
        return;
      }
    } else {
      loadBuiltinManifest();
    }

    // 密码始终用于本次连接（「记住密码」只决定是否持久化到本地存储）。
    const server: PersistedServer = {
      name: values.name,
      host: values.host,
      port: values.port,
      username: values.username,
      rememberPassword: values.rememberPassword,
      password: values.password,
    };
    // 持久化副本：仅勾选「记住密码」时才保存密码（与明文存储风险提示一致）。
    const persisted: PersistedServer = {
      ...server,
      password: values.rememberPassword ? values.password : undefined,
    };
    // Remember the server in the local list (password only when opted-in).
    addServer(persisted);
    setFormError(null);
    connect(server, { clientProxy, manifestSource });
  }

  function onFileSelected(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      setCustomYaml(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  }

  // -- render ---------------------------------------------------------------

  const serverOptions = servers.map((s) => ({ value: s.name, label: `${s.name} (${s.username}@${s.host})` }));

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 48 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            <CloudServerOutlined /> Fenix Server
          </Typography.Title>
          <Text type="secondary">选择或新增服务器配置，建立 SSH 连接并加载任务清单。</Text>
        </div>

        <Card title="服务器" size="small">
          <Form
            form={form}
            layout="vertical"
            initialValues={{ port: 22, username: 'root' }}
            onFinish={handleConnect}
            autoComplete="off"
          >
            {/* Existing server picker */}
            <Form.Item label="已保存的服务器">
              <Space.Compact style={{ width: '100%' }}>
                <Select
                  placeholder="选择已保存的服务器…"
                  options={serverOptions}
                  value={selectedServerName}
                  onChange={(name) => {
                    setSelectedServerName(name);
                    const server = servers.find((s) => s.name === name);
                    if (server) {
                      form.setFieldsValue({
                        name: server.name,
                        host: server.host,
                        port: server.port,
                        username: server.username,
                        password: server.password,
                        rememberPassword: server.rememberPassword ?? false,
                      });
                    }
                  }}
                  style={{ flex: 1 }}
                  allowClear
                  onClear={() => setSelectedServerName(undefined)}
                />
                {selectedServer && (
                  <Button
                    danger
                    onClick={() => {
                      removeServer(selectedServerName!);
                      setSelectedServerName(undefined);
                      form.resetFields(['name', 'host', 'port', 'username', 'password']);
                    }}
                  >
                    删除
                  </Button>
                )}
              </Space.Compact>
            </Form.Item>

            <Form.Item
              label="名称"
              name="name"
              rules={[{ required: true, message: '请输入服务器名称' }]}
            >
              <Input placeholder="例如：阿里云上海" />
            </Form.Item>

            <Space size="middle" style={{ display: 'flex' }}>
              <Form.Item
                label="主机"
                name="host"
                style={{ flex: 1 }}
                rules={[
                  { required: true, message: '请输入主机地址' },
                  { pattern: HOST_PATTERN, message: '主机地址格式不正确（IP 或域名）' },
                ]}
              >
                <Input placeholder="1.2.3.4 或 example.com" />
              </Form.Item>
              <Form.Item
                label="端口"
                name="port"
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <InputNumber min={1} max={65535} style={{ width: 110 }} />
              </Form.Item>
            </Space>

            <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input placeholder="root" />
            </Form.Item>

            <Form.Item label="密码" name="password">
              <Input.Password placeholder="SSH 登录密码（使用公钥认证时可为空）" />
            </Form.Item>

            <Form.Item label="记住密码" name="rememberPassword" valuePropName="checked">
              <Switch checkedChildren="记住" unCheckedChildren="不记住" />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.rememberPassword !== cur.rememberPassword}>
              {({ getFieldValue }) =>
                getFieldValue('rememberPassword') ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="密码将以明文形式保存在本机浏览器存储中，存在泄露风险；仅在可信的个人设备上启用。"
                  />
                ) : null
              }
            </Form.Item>

            <Form.Item label="客户端代理地址（隧道出口）">
              <Input
                value={clientProxy}
                onChange={(e) => setClientProxy(e.target.value)}
                placeholder="127.0.0.1:7890"
                status={clientProxy && !PROXY_PATTERN.test(clientProxy) ? 'error' : undefined}
              />
              {clientProxy && !PROXY_PATTERN.test(clientProxy) ? (
                <Text type="danger">代理地址格式应为 host:port</Text>
              ) : (
                <Text type="secondary">本机代理地址，用于反向隧道与需代理的任务。留空表示不指定。</Text>
              )}
            </Form.Item>

            <Form.Item label="任务清单来源">
              <Radio.Group value={manifestSource} onChange={(e) => setManifestSource(e.target.value)}>
                <Radio value="builtin">内置默认清单</Radio>
                <Radio value="custom">自定义 YAML</Radio>
              </Radio.Group>
            </Form.Item>

            {manifestSource === 'custom' && (
              <Form.Item
                label="自定义任务清单（YAML）"
                required
                validateStatus={formError && /YAML/.test(formError) ? 'error' : undefined}
              >
                <Input.TextArea
                  rows={6}
                  value={customYaml}
                  onChange={(e) => setCustomYaml(e.target.value)}
                  placeholder={'meta:\n  name: my-tasks\n  version: 1\ntasks:\n  - id: task-1\n    title: 任务一\n    commands:\n      - echo hello'}
                />
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => fileInputRef.current?.click()}>
                    选择 YAML 文件
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".yaml,.yml"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onFileSelected(file);
                      e.target.value = '';
                    }}
                  />
                  <Text type="secondary">也可直接粘贴 YAML 内容。</Text>
                </Space>
              </Form.Item>
            )}

            {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}
            {sshStatus === 'error' && lastError && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
                message={categorizeError(lastError).text}
                description={lastError}
              />
            )}

            <Button
              type="primary"
              htmlType="submit"
              size="large"
              loading={connecting}
              disabled={connecting}
              style={{ width: '100%' }}
            >
              {connecting ? '正在连接…' : '连接'}
            </Button>
          </Form>
        </Card>
      </Space>
    </div>
  );
}
