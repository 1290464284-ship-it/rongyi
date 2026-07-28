import { useRoutes } from 'react-router-dom';
import { routes } from './routes';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary listenToAsyncErrors={false}>
      {useRoutes(routes)}
    </ErrorBoundary>
  );
}
