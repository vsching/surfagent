import { connectToTab } from './connector.js';
import { getAllTabs, TabInfo } from './tabs.js';

// Durable, human-readable handles for tabs.
//
// A label is stored two ways:
//   1. In-page as `window.name = "surfagent:<label>"` — survives navigation and
//      daemon→Chrome reconnects (tab ids churn on reconnect, window.name does
//      not). This is the source of truth.
//   2. In an in-memory map (label -> tab id) for fast lookups on the hot path.
//
// Normal resolution hits the memory map. On a miss (cold daemon, or id churned
// after reconnect) we scan window.name across all tabs to rebuild the map, so a
// labelled tab is always recoverable as long as it is still open.

const PREFIX = 'surfagent:';

const labelToId = new Map<string, string>();
const idToLabel = new Map<string, string>();

function remember(label: string, id: string) {
  // A label maps to exactly one tab; a tab carries at most one label.
  const prevId = labelToId.get(label);
  if (prevId && prevId !== id) idToLabel.delete(prevId);
  const prevLabel = idToLabel.get(id);
  if (prevLabel && prevLabel !== label) labelToId.delete(prevLabel);
  labelToId.set(label, id);
  idToLabel.set(id, label);
}

async function readWindowName(id: string, port: number, host: string): Promise<string | null> {
  const client = await connectToTab(id, port, host);
  try {
    const r = await client.Runtime.evaluate({ expression: 'window.name', returnByValue: true });
    const v = r?.result?.value;
    return typeof v === 'string' ? v : null;
  } finally {
    await client.close();
  }
}

// Eval window.name across every open tab and rebuild the in-memory maps from any
// `surfagent:` markers found. Run only on a cache miss — it opens one CDP
// connection per tab.
async function rebuildFromPages(port: number, host: string): Promise<void> {
  const tabs = await getAllTabs(port, host);
  labelToId.clear();
  idToLabel.clear();
  for (const t of tabs) {
    try {
      const name = await readWindowName(t.id, port, host);
      if (name && name.startsWith(PREFIX)) {
        const label = name.slice(PREFIX.length);
        if (label) remember(label, t.id);
      }
    } catch {
      // tab not eval-able (e.g. chrome:// page) — skip
    }
  }
}

// Assign (or clear) a label on a tab. Writes window.name and updates the map.
export async function setLabel(tab: TabInfo, label: string, port: number, host: string): Promise<void> {
  const value = label ? PREFIX + label : '';
  const client = await connectToTab(tab.id, port, host);
  try {
    await client.Runtime.evaluate({
      expression: `window.name = ${JSON.stringify(value)}`,
      returnByValue: true,
    });
  } finally {
    await client.close();
  }
  if (label) remember(label, tab.id);
  else {
    const prev = idToLabel.get(tab.id);
    if (prev) labelToId.delete(prev);
    idToLabel.delete(tab.id);
  }
}

// Resolve a label to a currently-open tab id, or null. Verifies the cached id is
// still open; on a stale/missing entry it rescans window.name once.
export async function resolveLabel(label: string, port: number, host: string): Promise<string | null> {
  const validate = async (): Promise<string | null> => {
    const id = labelToId.get(label);
    if (!id) return null;
    const tabs = await getAllTabs(port, host);
    return tabs.some(t => t.id === id) ? id : null;
  };

  let id = await validate();
  if (id) return id;

  // miss or stale → rebuild from in-page markers and try once more
  await rebuildFromPages(port, host);
  return await validate();
}

// Label for a given tab id, if any (read from the in-memory map only — cheap,
// for decorating GET /tabs).
export function labelForId(id: string): string | undefined {
  return idToLabel.get(id);
}
