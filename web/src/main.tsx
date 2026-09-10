/**
 * web/src/main.tsx
 *
 * Application entry point: mount the React tree inside antd's ConfigProvider
 * (zh_CN locale + dark-ish compact theme is a design choice; the shell is
 * desktop-first per the design doc §8). The App reads the store and shows the
 * connection view until a session is established.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2f6fed',
          borderRadius: 6,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
