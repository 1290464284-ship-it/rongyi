import { ResourcePage } from './ResourcePage';

/**
 * Read-only statistics endpoint table. Kept as a thin wrapper around the
 * shared ResourcePage read-only mode for hub-tabs compatibility; the duplicate
 * list/format logic now lives in one place (ResourcePage).
 */
export function SimpleListPage({ title, endpoint }: { title: string; endpoint: string }) {
  return <ResourcePage title={title} endpoint={endpoint} />;
}
