export interface FillField {
    selector: string;
    value: string;
}
export interface FillRequest {
    tab: string;
    fields: FillField[];
    submit?: string;
}
export interface FillResult {
    filled: {
        selector: string;
        success: boolean;
        error?: string;
    }[];
    submitted?: boolean;
}
export declare function fillFields(request: FillRequest, options: {
    port?: number;
    host?: string;
}): Promise<FillResult>;
export interface ClickRequest {
    tab: string;
    selector?: string;
    text?: string;
    waitAfter?: number;
}
export declare function clickElement(request: ClickRequest, options: {
    port?: number;
    host?: string;
}): Promise<{
    success: boolean;
    clicked?: string;
    error?: string;
}>;
export interface ScrollRequest {
    tab: string;
    direction?: 'down' | 'up';
    amount?: number;
}
export declare function scrollPage(request: ScrollRequest, options: {
    port?: number;
    host?: string;
}): Promise<{
    scrollY: number;
    scrollHeight: number;
    viewportHeight: number;
    atBottom: boolean;
    contentPreview: string;
}>;
export interface NavigateRequest {
    tab: string;
    url?: string;
    back?: boolean;
    forward?: boolean;
    waitMs?: number;
}
export declare function navigatePage(request: NavigateRequest, options: {
    port?: number;
    host?: string;
}): Promise<{
    url: string;
    title: string;
}>;
export declare function evalInTab(tab: string, expression: string, options: {
    port?: number;
    host?: string;
}): Promise<any>;
export declare function readPage(tabPattern: string, options: {
    port?: number;
    host?: string;
    selector?: string;
}): Promise<any>;
export declare function dismissOverlays(tabPattern: string, options: {
    port?: number;
    host?: string;
}): Promise<any>;
export interface CaptchaRequest {
    tab: string;
    action: 'detect' | 'read' | 'next' | 'prev' | 'submit' | 'audio' | 'restart';
}
export declare function captchaInteract(request: CaptchaRequest, options: {
    port?: number;
    host?: string;
}): Promise<any>;
export declare function focusTab(tabPattern: string, options: {
    port?: number;
    host?: string;
}): Promise<{
    id: string;
    title: string;
    url: string;
}>;
export declare function typeKeys(tabPattern: string, keys: string, options: {
    port?: number;
    host?: string;
    submit?: string;
}): Promise<{
    typed: number;
    submitted?: boolean;
}>;
export interface DispatchRequest {
    tab: string;
    selector: string;
    event: string;
    bubbles?: boolean;
    cancelable?: boolean;
    detail?: any;
    eventInit?: Record<string, any>;
    reactDebug?: boolean;
}
export declare function dispatchEvent(request: DispatchRequest, options: {
    port?: number;
    host?: string;
}): Promise<{
    success: boolean;
    dispatched?: string;
    reactHandlers?: any[];
    error?: string;
}>;
/**
 * Upload one or more local files into a file input via CDP
 * DOM.setFileInputFiles — no native picker, works headless/automated.
 * `files` are absolute paths on the machine running the daemon.
 */
export declare function uploadFiles(tab: string, selector: string, files: string[], options: {
    port?: number;
    host?: string;
}): Promise<any>;
/**
 * Emulate a device viewport via CDP Emulation.setDeviceMetricsOverride — changes
 * what the page sees (innerWidth) and triggers CSS media queries, so mobile
 * layouts actually render. Pass width=0 (or reset:true) to clear the override.
 * The override persists on the target after this connection closes.
 */
export declare function setViewport(tab: string, opts: {
    width: number;
    height: number;
    mobile?: boolean;
    deviceScaleFactor?: number;
    reset?: boolean;
}, options: {
    port?: number;
    host?: string;
}): Promise<any>;
