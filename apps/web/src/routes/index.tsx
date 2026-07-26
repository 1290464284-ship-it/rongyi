import { Suspense } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuthStore } from '@/lib/store/auth-store';
import { appRoutes, type AppRoute, type Role } from '@/lib/app-routes';
import { lazy } from 'react';

const LoginPage = lazy(() => import('@/modules/auth/LoginPage'));
const NotFoundPage = lazy(() => import('@/components/NotFoundPage'));

const SuspenseElement = ({ element }: { element: React.ReactNode }) => (
  <ErrorBoundary variant="inline">
    <Suspense fallback={<div className="p-6 text-center text-muted-foreground">加载中...</div>}>
      {element}
    </Suspense>
  </ErrorBoundary>
);

function RoleRoute({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user || !roles.includes(user.role as Role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function buildRouteElements(routes: AppRoute[]): RouteObject[] {
  return routes
    .map((route) => {
      if (route.redirect) {
        return {
          path: route.path,
          element: <Navigate to={route.redirect} replace />,
        } as RouteObject;
      }

      if (route.children && route.children.length > 0) {
        const childElements: RouteObject[] = [];
        const indexChild = route.children.find((c) => c.path === '' || c.isIndex);
        
        if (indexChild && indexChild.component) {
          childElements.push({
            index: true,
            element: (
              <RoleRoute roles={indexChild.roles}>
                <SuspenseElement element={<indexChild.component />} />
              </RoleRoute>
            ),
          });
        }

        const otherChildren = buildRouteElements(
          route.children.filter((c) => c.path !== '' && !c.isIndex)
        );
        childElements.push(...otherChildren);

        return {
          path: route.path,
          children: childElements,
        } as RouteObject;
      }

      if (route.component) {
        return {
          path: route.path,
          element: (
            <RoleRoute roles={route.roles}>
              <SuspenseElement element={<route.component />} />
            </RoleRoute>
          ),
        } as RouteObject;
      }

      return null;
    })
    .filter(Boolean) as RouteObject[];
}

const dynamicRoutes = buildRouteElements(appRoutes);

export const routes = [
  {
    path: '/login',
    element: <SuspenseElement element={<LoginPage />} />
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to='/dashboard' replace /> },
      ...dynamicRoutes,
      { path: 'charge', element: <Navigate to="/charge-v2" replace /> },
      { path: 'follow-ups-v2', element: <Navigate to="/follow-ups" replace /> },
      { path: '*', element: <SuspenseElement element={<NotFoundPage />} /> },
    ],
  },
];
