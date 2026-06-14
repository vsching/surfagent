import { TabInfo } from './tabs.js';
export declare function setLabel(tab: TabInfo, label: string, port: number, host: string): Promise<void>;
export declare function resolveLabel(label: string, port: number, host: string): Promise<string | null>;
export declare function labelForId(id: string): string | undefined;
