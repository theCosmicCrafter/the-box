// SPDX-License-Identifier: LicenseRef-Proprietary
// IVault - the only way box-core touches files. Platform-agnostic:
// apps/desktop adapts real fs + shell.trashItem; tests use MemoryVault.
// All paths are PathRel strings relative to the workspace root.

export interface FileEntry {
  path: string; // PathRel
  size: number;
  mtime?: number; // ms epoch; same-size edit + rename detection signal
  sha256?: string; // computed lazily when rename detection needs it
}

export interface IVault {
  /** Read a file's utf8 content; null if absent. */
  read(path: string): Promise<string | null>;
  /** Write-temp-then-rename; never in-place. */
  writeAtomic(path: string, content: string): Promise<void>;
  /** Recoverable deletion (Recycle Bin). Never a hard unlink. */
  trash(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Inventory the workspace (excluding .box internals the scan specifies). */
  scan(): Promise<FileEntry[]>;
}

/** In-memory vault for tests and headless reconcile verification. */
export class MemoryVault implements IVault {
  files = new Map<string, string>();
  trashed: string[] = [];
  writes: { path: string; content: string }[] = [];

  seed(path: string, content: string): void {
    this.files.set(path, content);
  }

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.files.set(path, content);
  }

  async trash(path: string): Promise<void> {
    this.files.delete(path);
    this.trashed.push(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async scan(): Promise<FileEntry[]> {
    return [...this.files.keys()].map((path) => ({
      path,
      size: this.files.get(path)?.length ?? 0,
    }));
  }
}
