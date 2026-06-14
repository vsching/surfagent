import { listTargets, CDPTarget } from './connector.js';

export interface TabInfo {
  id: string;
  index: number;
  title: string;
  url: string;
}

// Thrown when a substring `tab` pattern matches more than one tab. Silent
// first-match is the #1 cause of an agent driving the wrong tab; we make it a
// loud, self-correcting error instead so the caller picks an exact id/index.
export class AmbiguousTabError extends Error {
  matches: TabInfo[];
  pattern: string;
  constructor(pattern: string, matches: TabInfo[]) {
    super(
      `Ambiguous tab: "${pattern}" matched ${matches.length} tabs. ` +
      `Re-target by exact index or id. Candidates: ` +
      matches.map(t => `[${t.index}] ${t.id} ${t.title || t.url}`).join(' | ')
    );
    this.name = 'AmbiguousTabError';
    this.matches = matches;
    this.pattern = pattern;
  }
}

// All tabs whose URL or title contains `pattern` (case-insensitive).
export function matchTabsBySubstring(tabs: TabInfo[], pattern: string): TabInfo[] {
  const lower = pattern.toLowerCase();
  return tabs.filter(t =>
    t.url.toLowerCase().includes(lower) ||
    t.title.toLowerCase().includes(lower)
  );
}

export async function getAllTabs(port?: number, host?: string): Promise<TabInfo[]> {
  const targets = await listTargets(port, host);
  return targets.map((target: CDPTarget, index: number) => ({
    id: target.id,
    index,
    title: target.title,
    url: target.url
  }));
}

export async function findTab(pattern: string, port?: number, host?: string): Promise<TabInfo | null> {
  const tabs = await getAllTabs(port, host);

  // Check if pattern is a number (index)
  const index = parseInt(pattern, 10);
  if (!isNaN(index) && index >= 0 && index < tabs.length) {
    return tabs[index];
  }

  // Check if pattern matches tab ID (exact = unambiguous)
  const byId = tabs.find(tab => tab.id === pattern);
  if (byId) return byId;

  // Substring match on URL or title. If >1 tab matches, refuse to guess.
  const matches = matchTabsBySubstring(tabs, pattern);
  if (matches.length > 1) throw new AmbiguousTabError(pattern, matches);
  return matches[0] || null;
}
