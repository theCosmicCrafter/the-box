// SPDX-License-Identifier: LicenseRef-Proprietary
// Stage 0 surface: the workspace file list. Canvas arrives Stage 1 (OQ-7).

import type { WorkspaceFile } from './store.js';

const KIND_ORDER = ['image', 'video', 'audio', 'markdown', 'ink', 'note', 'file'] as const;

function kindOf(path: string): (typeof KIND_ORDER)[number] {
  const p = path.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif|tiff?)$/.test(p)) return 'image';
  if (/\.(mp4|webm|mov|mkv)$/.test(p)) return 'video';
  if (/\.(mp3|wav|flac|ogg|m4a)$/.test(p)) return 'audio';
  if (/^link-[0-9a-f]{16}\.md$/.test(p.split('/').pop() ?? '')) return 'note';
  if (p.endsWith('.md')) return 'markdown';
  if (p.endsWith('.ink.svg')) return 'ink';
  return 'file';
}

export function FileList(props: { files: WorkspaceFile[] }) {
  const grouped = new Map<string, WorkspaceFile[]>();
  for (const f of props.files) {
    const k = kindOf(f.path);
    grouped.set(k, [...(grouped.get(k) ?? []), f]);
  }
  const keys = KIND_ORDER.filter((k) => grouped.has(k));
  return (
    <div className="file-list">
      {keys.map((k) => (
        <section key={k}>
          <h3>
            {k} <span className="count">{grouped.get(k)?.length}</span>
          </h3>
          <ul>
            {(grouped.get(k) ?? []).map((f) => (
              <li key={f.path}>
                <code>{f.path}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {props.files.length === 0 && <p className="empty">No files in this workspace yet.</p>}
    </div>
  );
}
