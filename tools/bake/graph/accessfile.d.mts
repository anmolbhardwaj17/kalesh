export function formatJson(v: unknown, indent?: number): string;
export function accessText(file: Record<string, unknown>): string;
export function readAccessFile(file: string): Record<string, any>;
export function writeAccessFile(file: string, data: Record<string, unknown>): void;
