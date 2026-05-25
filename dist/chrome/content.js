import { connectToTab } from './connector.js';
import { getAllTabs } from './tabs.js';
export async function getTabContent(tab, port, host, selector) {
    let client = null;
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
        const content = result.result.value || '';
        return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            content: content.trim()
        };
    }
    finally {
        if (client) {
            await client.close();
        }
    }
}
export async function getAllTabsContent(port, host) {
    const tabs = await getAllTabs(port, host);
    const contents = [];
    for (const tab of tabs) {
        try {
            const content = await getTabContent(tab, port, host);
            contents.push(content);
        }
        catch (error) {
            // If we can't get content from a tab, include it with empty content
            contents.push({
                id: tab.id,
                title: tab.title,
                url: tab.url,
                content: `[Error extracting content: ${error.message}]`
            });
        }
    }
    return contents;
}
export async function searchTabs(query, port, host) {
    const contents = await getAllTabsContent(port, host);
    const results = [];
    const lowerQuery = query.toLowerCase();
    for (const tab of contents) {
        const lines = tab.content.split('\n');
        const matches = [];
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
export async function takeScreenshot(tab, portOrOptions, host) {
    // Back-compat: takeScreenshot(tab, port, host) AND takeScreenshot(tab, { fullPage, ... })
    const opts = typeof portOrOptions === 'object'
        ? portOrOptions
        : { port: portOrOptions, host };
    const format = opts.format ?? 'png';
    let client = null;
    try {
        client = await connectToTab(tab.id, opts.port, opts.host);
        const params = {
            format,
            fromSurface: true,
        };
        if (format === 'jpeg' && typeof opts.quality === 'number') {
            params.quality = Math.max(0, Math.min(100, opts.quality));
        }
        if (opts.fullPage) {
            // Full-page = CDP captureBeyondViewport + explicit clip from layout metrics.
            // Avoids viewport-resize side-effects on the live page.
            const metrics = await client.Page.getLayoutMetrics();
            const content = metrics.cssContentSize || metrics.contentSize || {};
            const width = Math.ceil(content.width);
            const height = Math.ceil(content.height);
            if (width > 0 && height > 0) {
                params.captureBeyondViewport = true;
                params.clip = { x: 0, y: 0, width, height, scale: 1 };
            }
        }
        const result = await client.Page.captureScreenshot(params);
        return result.data; // Base64 encoded
    }
    finally {
        if (client) {
            await client.close();
        }
    }
}
