import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AnimatedRoute } from './AnimatedRoute';

export default function AppLayout() {
  const location = useLocation();
  return (
    <div className="h-screen flex">
      {/* skip-to-content: 键盘用户首焦直达主内容 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
      >
        跳到主内容
      </a>
      <ErrorBoundary variant="inline">
        <Sidebar />
      </ErrorBoundary>
      <div className="flex-1 flex flex-col overflow-hidden">
        <ErrorBoundary variant="inline">
          <Topbar />
        </ErrorBoundary>
        <main id="main-content" className="flex-1 overflow-auto bg-background" tabIndex={-1}>
          <div className="max-w-[1440px] mx-auto h-full">
            <ErrorBoundary key={location.pathname} variant="inline">
              <AnimatedRoute>
                <Outlet />
              </AnimatedRoute>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
