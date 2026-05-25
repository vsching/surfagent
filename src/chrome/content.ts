import { connectToTab, CDPClient } from './connector.js';
import { TabInfo, getAllTabs } from './tabs.js';

export interface TabContent {
  id: string;
  title: string;
  url: string;
  content: string;
}

export async function getTabContent(tab: TabInfo, port?: number, host?: string, selector?: string): Promise<TabContent> {
  let client: CDPClient | null = null;
  try {
    client = await connectToTab(tab.id, port, host);

    // Extract text content from the page (optionally from a specific selector)
    const result = await client.Runtime.evaluate({
      expression: `
        (function() {
          const selector = ${JSON.stringify(selector || null)};

          if (selector) {
            // Get text from specific element
            const element = document.querySelector(selector);
            if (element) {
              return element.innerText || element.textContent || '';
            }
            return '[Element not found: ' + selector + ']';
          }

          // Remove script and style elements
          const clone = document.body.cloneNode(true);
          const scripts = clone.querySelectorAll('script, style, noscript');
          scripts.forEach(el => el.remove());

          // Get text content
          return clone.innerText || clone.textContent || '';
        })()
      `,
      returnByValue: true
    });

    const content = result.result.value as string || '';

    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      content: content.trim()
    };
  } finally {
    if (client) {
      await client.close();
    }
  }
}

export async function getAllTabsContent(port?: number, host?: string): Promise<TabContent[]> {
  const tabs = await getAllTabs(port, host);
  const contents: TabContent[] = [];

  for (const tab of tabs) {
    try {
      const content = await getTabContent(tab, port, host);
      contents.push(content);
    } catch (error) {
      // If we can't get content from a tab, include it with empty content
      contents.push({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        content: `[Error extracting content: ${(error as Error).message}]`
      });
    }
  }

  return contents;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  matches: string[];
}

export async function searchTabs(query: string, port?: number, host?: string): Promise<SearchResult[]> {
  const contents = await getAllTabsContent(port, host);
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const tab of contents) {
    const lines = tab.content.split('\n');
    const matches: string[] = [];

    for (const line of lines) {
      if (line.toLowerCase().includes(lowerQuery)) {
        // Include some context around the match
        const trimmedLine = line.trim();
        if (trimmedLine.length > 0) {
          matches.push(trimmedLine.substring(0, 200));
        }
      }
    }

    if (matches.length > 0) {
      results.push({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        matches: matches.slice(0, 10) // Limit matches per tab
      });
    }
  }

  return results;
}

export interface ScreenshotOptions {
  port?: number;
  host?: string;
  fullPage?: boolean;       // capture beyond viewport (scrolls + stitches via CDP)
  format?: 'png' | 'jpeg';  // default png
  quality?: number;         // jpeg only, 0-100
}

export async function takeScreenshot(
  tab: TabInfo,
  portOrOptions?: number | ScreenshotOptions,
  host?: string,
): Promise<string> {
  // Back-compat: takeScreenshot(tab, port, host) AND takeScreenshot(tab, { fullPage, ... })
  const opts: ScreenshotOptions = typeof portOrOptions === 'object'
    ? portOrOptions
    : { port: portOrOptions, host };
  const format = opts.format ?? 'png';

  let client: CDPClient | null = null;
  try {
    client = await connectToTab(tab.id, opts.port, opts.host);

    const params: any = {
      format,
      fromSurface: true,
    };
    if (format === 'jpeg' && typeof opts.quality === 'number') {
      params.quality = Math.max(0, Math.min(100, opts.quality));
    }

    if (opts.fullPage) {
      // Full-page = CDP captureBeyondViewport + explicit clip from layout metrics.
      // Avoids viewport-resize side-effects on the live page.
      const metrics: any = await (client.Page as any).getLayoutMetrics();
      const content = metrics.cssContentSize || metrics.contentSize || {};
      const width = Math.ceil(content.width);
      const height = Math.ceil(content.height);
      if (width > 0 && height > 0) {
        params.captureBeyondViewport = true;
        params.clip = { x: 0, y: 0, width, height, scale: 1 };
      }
    }

    const result = await (client.Page as any).captureScreenshot(params);
    return result.data; // Base64 encoded
  } finally {
    if (client) {
      await client.close();
    }
  }
}
