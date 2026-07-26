import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

export interface SearchResult {
  type: string;
  typeLabel: string;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}

export function useSearch(keyword: string, enabled = true) {
  return useQuery({
    queryKey: ['search', keyword],
    queryFn: async () =>
      (await api.get<SearchResult[]>('/search', { params: { q: keyword } })).data,
    enabled: enabled && keyword.length >= 2,
  });
}
