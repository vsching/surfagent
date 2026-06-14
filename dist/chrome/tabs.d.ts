export interface TabInfo {
    id: string;
    index: number;
    title: string;
    url: string;
}
export declare class AmbiguousTabError extends Error {
    matches: TabInfo[];
    pattern: string;
    constructor(pattern: string, matches: TabInfo[]);
}
export declare function matchTabsBySubstring(tabs: TabInfo[], pattern: string): TabInfo[];
export declare function getAllTabs(port?: number, host?: string): Promise<TabInfo[]>;
export declare function findTab(pattern: string, port?: number, host?: string): Promise<TabInfo | null>;
