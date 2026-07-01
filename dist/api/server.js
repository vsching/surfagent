#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import nodepath from 'node:path';
import { reconUrl, reconTab } from './recon.js';
import { fillFields, clickElement, scrollPage, navigatePage, evalInTab, focusTab, readPage, captchaInteract, dismissOverlays, typeKeys, dispatchEvent, uploadFiles } from './act.js';
import { getAllTabs, findTab, AmbiguousTabError } from '../chrome/tabs.js';
import { setLabel, labelForId } from '../chrome/labels.js';
import { takeScreenshot } from '../chrome/content.js';
const PORT = parseInt(process.env.API_PORT || '3456', 10);
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CDP_HOST = process.env.CDP_HOST || 'localhost';
// Audit log — JSONL per UTC date under ~/.surfagent/audit/.
// Disable by setting AUDIT_LOG=off. Override path with SURFAGENT_AUDIT_DIR.
const AUDIT_ENABLED = (process.env.AUDIT_LOG ?? 'on').toLowerCase() !== 'off';
const AUDIT_DIR = process.env.SURFAGENT_AUDIT_DIR || nodepath.join(os.homedir(), '.surfagent', 'audit');
if (AUDIT_ENABLED) {
    try {
        fs.mkdirSync(AUDIT_DIR, { recursive: true });
    }
    catch { }
}
function appendAudit(entry) {
    if (!AUDIT_ENABLED)
        return;
    try {
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
        const file = nodepath.join(AUDIT_DIR, `${date}.jsonl`);
        fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    }
    catch (err) {
        console.error(`[surfagent] audit write failed: ${err.message}`);
    }
}
function redactBody(body) {
    if (!body || typeof body !== 'object')
        return body;
    // Strip noisy / sensitive fields. Keep selectors + tab refs for replay value.
    const { fields, value, keys, expression, ...rest } = body;
    const out = { ...rest };
    if (Array.isArray(fields))
        out.fields = fields.map((f) => ({ selector: f?.selector, valueLen: typeof f?.value === 'string' ? f.value.length : undefined }));
    if (typeof value === 'string')
        out.valueLen = value.length;
    if (typeof keys === 'string')
        out.keysLen = keys.length;
    if (typeof expression === 'string')
        out.expressionLen = expression.length;
    return out;
}
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString();
}
function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
}
function parseBody(raw) {
    if (!raw || !raw.trim())
        throw new SyntaxError('Empty request body');
    return JSON.parse(raw);
}
function cors(res) {
    res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
}
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    if (req.method === 'OPTIONS')
        return cors(res);
    // --- audit hook (fires after response sent) ---
    const reqStart = Date.now();
    let capturedStatus = 0;
    let capturedErrorMsg;
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, ...rest) => {
        capturedStatus = status;
        return originalWriteHead(status, ...rest);
    };
    res.on('finish', () => {
        if (!AUDIT_ENABLED)
            return;
        appendAudit({
            ts: new Date().toISOString(),
            endpoint: path,
            method: req.method,
            status: capturedStatus,
            durationMs: Date.now() - reqStart,
            ...(capturedErrorMsg ? { error: capturedErrorMsg } : {}),
        });
    });
    try {
        // POST /recon — full page reconnaissance
        if (path === '/recon' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.url && !body.tab) {
                return json(res, 400, { error: 'Provide "url" (to open new page) or "tab" (to recon existing tab)' });
            }
            const start = Date.now();
            let result;
            if (body.url) {
                result = await reconUrl(body.url, {
                    port: CDP_PORT,
                    host: CDP_HOST,
                    waitMs: body.waitMs,
                    keepTab: body.keepTab,
                });
            }
            else {
                result = await reconTab(body.tab, { port: CDP_PORT, host: CDP_HOST });
            }
            return json(res, 200, {
                ...result,
                _reconMs: Date.now() - start,
            });
        }
        // POST /fill — fill form fields via CDP keystrokes
        if (path === '/fill' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab || !body.fields) {
                return json(res, 400, { error: 'Provide "tab" and "fields" [{ selector, value }]' });
            }
            if (!Array.isArray(body.fields)) {
                return json(res, 400, { error: '"fields" must be an array of { selector, value }' });
            }
            const start = Date.now();
            const result = await fillFields(body, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, { ...result, _fillMs: Date.now() - start });
        }
        // POST /click — click an element
        if (path === '/click' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab || (!body.selector && !body.text)) {
                return json(res, 400, { error: 'Provide "tab" and "selector" or "text"' });
            }
            const result = await clickElement(body, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, result);
        }
        // POST /scroll — scroll a page
        if (path === '/scroll' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab) {
                return json(res, 400, { error: 'Provide "tab", optional "direction" (down/up), "amount" (pixels)' });
            }
            const result = await scrollPage(body, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, result);
        }
        // POST /dismiss — dismiss cookie banners, modals, overlays
        if (path === '/dismiss' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab) {
                return json(res, 400, { error: 'Provide "tab"' });
            }
            const result = await dismissOverlays(body.tab, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, result);
        }
        // POST /captcha — detect and interact with captchas
        if (path === '/captcha' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.action) {
                return json(res, 400, { error: 'Provide "action": detect, read, next, prev, submit, audio, restart' });
            }
            if (body.action === 'detect' && !body.tab) {
                return json(res, 400, { error: 'Provide "tab" for detect action' });
            }
            const result = await captchaInteract(body, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, result);
        }
        // POST /read — get structured readable content from a page
        if (path === '/read' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab) {
                return json(res, 400, { error: 'Provide "tab", optional "selector"' });
            }
            const result = await readPage(body.tab, { port: CDP_PORT, host: CDP_HOST, selector: body.selector });
            return json(res, 200, result);
        }
        // POST /screenshot — capture PNG/JPEG of a tab (base64).
        // Body: { tab, fullPage?: bool, format?: 'png'|'jpeg', quality?: 0-100 (jpeg only) }
        // fullPage uses CDP captureBeyondViewport — no live-page resize side-effect.
        if (path === '/screenshot' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab) {
                return json(res, 400, { error: 'Provide "tab" (index, URL/title match, or domain). Optional: fullPage, format (png|jpeg), quality (jpeg only).' });
            }
            const tab = await findTab(body.tab, CDP_PORT, CDP_HOST);
            if (!tab) {
                return json(res, 404, { error: `Tab not found: ${body.tab}` });
            }
            const start = Date.now();
            const format = body.format === 'jpeg' ? 'jpeg' : 'png';
            const base64 = await takeScreenshot(tab, {
                port: CDP_PORT,
                host: CDP_HOST,
                fullPage: !!body.fullPage,
                format,
                quality: typeof body.quality === 'number' ? body.quality : undefined,
            });
            return json(res, 200, {
                ok: true,
                tab: { id: tab.id, title: tab.title, url: tab.url },
                format,
                mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
                fullPage: !!body.fullPage,
                base64,
                sizeBytes: Math.ceil((base64.length * 3) / 4),
                _screenshotMs: Date.now() - start,
            });
        }
        // POST /focus — bring a tab to front
        if (path === '/focus' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab) {
                return json(res, 400, { error: 'Provide "tab"' });
            }
            const result = await focusTab(body.tab, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, result);
        }
        // POST /label — assign a durable, human-readable handle to a tab.
        // Body: { tab, label }. label:"" clears it. Stored as window.name
        // (survives navigation + CDP reconnect). Drive later calls by the label.
        if (path === '/label' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab || typeof body.label !== 'string') {
                return json(res, 400, { error: 'Provide "tab" (index, id, or match) and "label" (string; "" to clear)' });
            }
            const tab = await findTab(body.tab, CDP_PORT, CDP_HOST);
            if (!tab) {
                return json(res, 404, { error: `Tab not found: ${body.tab}` });
            }
            await setLabel(tab, body.label, CDP_PORT, CDP_HOST);
            return json(res, 200, {
                ok: true,
                label: body.label || null,
                tab: { id: tab.id, title: tab.title, url: tab.url },
            });
        }
        // POST /eval — run JavaScript in a tab or iframe
        if (path === '/eval' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab || !body.expression) {
                return json(res, 400, { error: 'Provide "tab" and "expression"' });
            }
            const result = await evalInTab(body.tab, body.expression, { port: CDP_PORT, host: CDP_HOST });
            if (result && result.__error) {
                return json(res, 200, { result: null, error: result.__error });
            }
            return json(res, 200, { result });
        }
        // POST /upload — set files on a file input via CDP DOM.setFileInputFiles
        // (no native picker). Body: { tab, files: string[] (absolute paths), selector? }
        if (path === '/upload' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab || !Array.isArray(body.files) || body.files.length === 0) {
                return json(res, 400, { error: 'Provide "tab" and "files" (array of absolute paths). Optional "selector" (default input[type=file]).' });
            }
            const result = await uploadFiles(body.tab, body.selector || 'input[type=file]', body.files, { port: CDP_PORT, host: CDP_HOST });
            if (result && result.__error) {
                return json(res, 200, { ok: false, error: result.__error });
            }
            return json(res, 200, result);
        }
        // POST /type — raw CDP key typing, no clear step (for Google Sheets, contenteditable, etc.)
        if (path === '/type' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab || !body.keys) {
                return json(res, 400, { error: 'Provide "tab" and "keys" (string to type), optional "submit": "enter"|"tab"' });
            }
            const result = await typeKeys(body.tab, body.keys, { port: CDP_PORT, host: CDP_HOST, submit: body.submit });
            return json(res, 200, result);
        }
        // POST /dispatch — dispatch DOM events on elements (React SPA workaround)
        if (path === '/dispatch' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab || !body.selector || (!body.event && !body.reactDebug)) {
                return json(res, 400, { error: 'Provide "tab", "selector", and "event" (e.g. "submit", "click"). Add "reactDebug":true to inspect React handlers instead.' });
            }
            const start = Date.now();
            const result = await dispatchEvent(body, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, { ...result, _dispatchMs: Date.now() - start });
        }
        // POST /navigate — go to url, back, or forward in same tab
        if (path === '/navigate' && req.method === 'POST') {
            const body = parseBody(await readBody(req));
            if (!body.tab) {
                return json(res, 400, { error: 'Provide "tab" and one of: "url", "back":true, "forward":true' });
            }
            if (!body.url && !body.back && !body.forward) {
                return json(res, 400, { error: 'Provide one of: "url", "back":true, "forward":true' });
            }
            if ((body.url && body.back) || (body.url && body.forward) || (body.back && body.forward)) {
                return json(res, 400, { error: 'Provide only one of: "url", "back", "forward"' });
            }
            const result = await navigatePage(body, { port: CDP_PORT, host: CDP_HOST });
            return json(res, 200, result);
        }
        // GET /tabs — list open tabs (with any assigned label)
        if (path === '/tabs' && req.method === 'GET') {
            const tabs = await getAllTabs(CDP_PORT, CDP_HOST);
            return json(res, 200, { tabs: tabs.map(t => ({ ...t, label: labelForId(t.id) ?? null })) });
        }
        // GET /audit — replay structured action history (JSONL parsed)
        // Query: ?date=YYYY-MM-DD (UTC, default today) | ?limit=N (default 100)
        if (path === '/audit' && req.method === 'GET') {
            const dateParam = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
            const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 5000));
            const file = nodepath.join(AUDIT_DIR, `${dateParam}.jsonl`);
            if (!fs.existsSync(file)) {
                return json(res, 200, { date: dateParam, entries: [], total: 0 });
            }
            const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
            const entries = lines.slice(-limit).map((line) => {
                try {
                    return JSON.parse(line);
                }
                catch {
                    return { _parseError: true, raw: line };
                }
            });
            return json(res, 200, { date: dateParam, entries, total: lines.length, returned: entries.length });
        }
        // GET /health
        if (path === '/health') {
            try {
                const tabs = await getAllTabs(CDP_PORT, CDP_HOST);
                return json(res, 200, { status: 'ok', cdpConnected: true, tabCount: tabs.length, auditEnabled: AUDIT_ENABLED, auditDir: AUDIT_ENABLED ? AUDIT_DIR : null });
            }
            catch {
                return json(res, 503, { status: 'error', cdpConnected: false });
            }
        }
        json(res, 404, { error: 'Not found. Endpoints: POST /recon, /read, /fill, /click, /type, /scroll, /navigate, /eval, /dispatch, /dismiss, /captcha, /focus, /label, /screenshot | GET /tabs, /audit, /health' });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        capturedErrorMsg = message;
        console.error(`[${new Date().toISOString()}] Error:`, message);
        if (error instanceof SyntaxError) {
            return json(res, 400, { error: 'Invalid JSON: ' + message });
        }
        if (error instanceof AmbiguousTabError) {
            return json(res, 409, {
                ok: false,
                code: 'AMBIGUOUS_TAB',
                error: message,
                pattern: error.pattern,
                matches: error.matches,
            });
        }
        if (message.includes('Tab not found')) {
            return json(res, 404, { error: message });
        }
        if (message.includes('Cannot connect to Chrome') || message.includes('ECONNREFUSED')) {
            return json(res, 503, { error: 'Chrome not running. Start with: surfagent start' });
        }
        json(res, 500, { error: message });
    }
});
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[surfagent] Port ${PORT} is already in use. API may already be running.`);
        console.error(`[surfagent] Check with: curl localhost:${PORT}/health`);
        process.exit(1);
    }
    throw err;
});
server.listen(PORT, () => {
    console.log(`Browser Recon API running on http://localhost:${PORT}`);
    console.log(`CDP target: ${CDP_HOST}:${CDP_PORT}`);
    if (AUDIT_ENABLED)
        console.log(`Audit log: ${AUDIT_DIR} (set AUDIT_LOG=off to disable)`);
    console.log(`\nEndpoints:`);
    console.log(`  POST /recon       — { url: "..." } or { tab: "0" }`);
    console.log(`  POST /fill        — { tab, fields: [{ selector, value }], submit? }`);
    console.log(`  POST /click       — { tab, selector? , text? }`);
    console.log(`  POST /screenshot  — { tab }  → { base64, mimeType, sizeBytes }`);
    console.log(`  POST /dispatch    — { tab, selector, event, reactDebug? }`);
    console.log(`  POST /label       — { tab, label }  durable handle (window.name)`);
    console.log(`  GET  /tabs        — list open Chrome tabs`);
    console.log(`  GET  /audit       — replay action log (?date=YYYY-MM-DD&limit=N)`);
    console.log(`  GET  /health      — check CDP connection`);
});
