// SPDX-License-Identifier: LicenseRef-Proprietary
// Stage 0 shell: open folder -> file list. Canvas lands Stage 1.

import { useBoxStore, FileList } from '@box/ui';
import type { WorkspaceFile } from '@box/ui';

declare global {
  interface Window {
    box?: {
      openWorkspace: () => Promise<{ root: string; files: WorkspaceFile[] } | null>;
      rescan: (root: string) => Promise<WorkspaceFile[]>;
    };
  }
}

export function App() {
  const { workspaceRoot, files, setWorkspace, setFiles } = useBoxStore();

  const open = async () => {
    const r = await window.box?.openWorkspace();
    if (r) setWorkspace(r.root, r.files);
  };

  const rescan = async () => {
    if (workspaceRoot && window.box) {
      setFiles(await window.box.rescan(workspaceRoot));
    }
  };

  return (
    <main className="shell">
      <header>
        <h1>The Box</h1>
        <p className="tagline">Objects are files. Arrows are notes. Edits round-trip.</p>
      </header>
      {workspaceRoot === null ? (
        <div className="welcome">
          <p>Open a folder to make it a workspace.</p>
          <button onClick={() => void open()}>Open workspace folder</button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <code>{workspaceRoot}</code>
            <button onClick={() => void rescan()}>Rescan</button>
          </div>
          <FileList files={files} />
        </>
      )}
    </main>
  );
}
