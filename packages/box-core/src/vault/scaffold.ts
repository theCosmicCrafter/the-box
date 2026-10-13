// SPDX-License-Identifier: LicenseRef-Proprietary
// Workspace scaffolding - the optional starter tree. ACCESS (Nick Milo's
// LYT kit): Atlas, Calendar, Cards, Extras, Sources, Spaces. Each folder
// gets one seed note so the directory exists in the scan (files are the
// only entries) and tells the user what the folder is for. home.md at
// the root is the entry MOC, mirroring LYT starter vaults.
// Contract: create-if-missing only. Never overwrite a file the user has.

export interface ScaffoldFile {
  path: string;
  content: string;
}

export const ACCESS_DIRS = [
  "atlas",
  "calendar",
  "cards",
  "extras",
  "sources",
  "spaces",
] as const;

const SEEDS: Record<(typeof ACCESS_DIRS)[number], string> = {
  atlas:
    "# Atlas\n\nMaps of Content live here - hub notes that link outward.\n",
  calendar: "# Calendar\n\nDaily and periodic notes.\n",
  cards: "# Cards\n\nNotes and ideas, one thought each.\n",
  extras:
    "# Extras\n\nTemplates, attachments, and everything without a home.\n",
  sources:
    "# Sources\n\nBooks, articles, references - things made elsewhere.\n",
  spaces: "# Spaces\n\nProjects and areas - the parts of life in motion.\n",
};

const HOME = `# Home

- atlas/ - maps of content
- calendar/ - daily and periodic notes
- cards/ - notes and ideas
- extras/ - attachments and templates
- sources/ - references
- spaces/ - projects and areas

Boards live in .box/ and open on the canvas.
`;

/** Every file the scaffold would write, whether or not it exists. */
export function scaffoldFiles(): ScaffoldFile[] {
  return [
    { path: "home.md", content: HOME },
    ...ACCESS_DIRS.map((d) => ({
      path: `${d}/${d}.md`,
      content: SEEDS[d],
    })),
  ];
}

/** Seed files whose path is not already present - never clobbers. */
export function missingScaffoldFiles(existing: Set<string>): ScaffoldFile[] {
  return scaffoldFiles().filter((f) => !existing.has(f.path));
}

/**
 * True if any ACCESS dir already has content. Used for the offer gate:
 * a workspace that has (even part of) its own structure is not offered
 * a scaffold over it.
 */
export function hasScaffoldDirs(existing: Iterable<string>): boolean {
  const prefixes = ACCESS_DIRS.map((d) => `${d}/`);
  for (const p of existing) {
    if (prefixes.some((pre) => p.startsWith(pre))) return true;
  }
  return false;
}
