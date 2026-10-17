// SPDX-License-Identifier: LicenseRef-Proprietary
// CmBodyEditor - CodeMirror 6 wrapper for note bodies (FR-207). Thin
// controlled surface: value in via `doc`, changes out via `onDoc`; the
// parent keeps the LinkNote truth. Frontmatter never enters the editor -
// NotePanel keeps it as structured read-only fields, which is what makes
// `box-edge` uneditable by construction.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
    defaultHighlightStyle,
    syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";

// App-palette dark theme - one-dark would ship 40 kB of styling we'd
// immediately override anyway.
const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "#e8ecf2",
      fontSize: "13px",
    },
    ".cm-content": {
      fontFamily: "ui-monospace, Consolas, 'Cascadia Mono', monospace",
      padding: "10px 12px",
      caretColor: "#7eb8ff",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#7eb8ff" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#243050",
    },
    ".cm-activeLine": { backgroundColor: "rgba(126,184,255,0.05)" },
  },
  { dark: true },
);

export interface CmBodyEditorProps {
  doc: string;
  placeholder?: string | undefined;
  onDoc: (text: string) => void;
}

export function CmBodyEditor({
  doc,
  placeholder: ph,
  onDoc,
}: CmBodyEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // onDoc is read at event time so the editor never needs re-creating.
  const onDocRef = useRef(onDoc);
  onDocRef.current = onDoc;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        extensions: [
          // In-editor undo lives in CM history (document-level), separate
          // from the board's placement undo - the App keydown guard sees
          // contenteditable and never double-fires it.
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          theme,
          EditorView.lineWrapping,
          ...(ph !== undefined ? [placeholder(ph)] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onDocRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per host - external doc changes arrive through the
    // resync effect below (note identity swap), not re-creation.
  }, []);

  // External updates (note switched, disk edit reloaded) resync the doc
  // only when they differ - typing never fights the parent state.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const cur = view.state.doc.toString();
    if (cur !== doc) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: doc } });
    }
  }, [doc]);

  return <div ref={hostRef} className="cm-body" />;
}
