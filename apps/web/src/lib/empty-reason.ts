import type { EmptyReason } from "../components/EmptyState";

export type ViewType = 'all' | 'recent' | 'favorites' | 'library' | 'collection';

export interface ActiveView {
  type: ViewType;
  id?: number;
}

/**
 * Works out why the document grid is empty.
 *
 * Derived from what produced the list rather than from the list being short: a
 * scoped search that matched nothing and a library with nothing in it are the
 * same empty array, and they want different words. That matters most on a
 * phone, where the scope chip lives inside the drawer, so a search with no
 * results otherwise looks like a library that has lost its contents.
 *
 * `scopeName` comes from the sidebar, which holds the libraries and
 * collections; null means the current view is not a scope worth naming.
 */
export function emptyReasonFor(
  searchQuery: string,
  activeView: ActiveView,
  scopeName: string | null,
): EmptyReason {
  const query = searchQuery.trim();

  if (query.length > 0) {
    // "Recent" is not a scope, so a search started there already ran against
    // everything and has nowhere wider to go.
    return {
      kind: 'search',
      query,
      scopeName: activeView.type === 'recent' ? null : scopeName,
    };
  }

  if (activeView.type === 'favorites') return { kind: 'favorites' };
  if (activeView.type === 'recent') return { kind: 'recent' };
  if (scopeName) return { kind: 'scope', scopeName };
  return { kind: 'library' };
}
