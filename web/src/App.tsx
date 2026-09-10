/**
 * web/src/App.tsx
 *
 * Application shell. (占位实现；Task 5.1 将其替换为完整壳：未连接→连接视图，
 * 已连接→顶栏/状态栏/三 Tab 主区。）
 */
import { Spin } from 'antd';

export default function App() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin tip="Fenix UI 初始化中…" size="large" />
    </div>
  );
}