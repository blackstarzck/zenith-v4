import { ConfigProvider } from 'antd';
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './router/app-router';

export function App() {
  const fontFamily = "Freesentation, Pretendard, 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  return (
    <BrowserRouter>
      <ConfigProvider
        theme={{
          token: {
            fontFamily
          }
        }}
      >
        <AppRouter />
      </ConfigProvider>
    </BrowserRouter>
  );
}
