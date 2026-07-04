import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';

/**
 * Standalone shell — sidebar + main content area.
 * No auth gating: the Electron host is responsible for token lifecycle.
 */
export function Layout() {
  return (
    <div className="flex h-full w-full bg-bg text-text">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
