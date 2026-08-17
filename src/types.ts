'use strict';

export type DisplayFormat = 'used/total' | 'usedOnly' | 'percentage' | 'compact';

export interface ProcessSummary {
  totalKb: number;
  matched: number;
  parseError?: boolean;
}

export interface ProcessSnapshot {
  platform: NodeJS.Platform;
  raw: string;
}

export interface EditorMemoryUsage {
  usedKb: number;
  processCount: number;
  systemTotalBytes: number;
}

export interface ExtensionFolderInfo {
  id: string;
  version: string;
}

export interface DuplicateExtension {
  id: string;
  versions: string[];
}

export interface WindowsProcessItem {
  ProcessId?: number;
  WorkingSetSize?: number;
  ExecutablePath?: string;
}
