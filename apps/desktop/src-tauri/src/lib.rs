// SPDX-License-Identifier: LicenseRef-Proprietary
// The Box - Tauri platform layer. Rust owns filesystem, watcher, protocol,
// and native shell ops; the webview owns model/reconcile/canvas (box-core
// stays pure TS). Same split as the Electron main it replaces.

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

// ---- types matching the renderer contract (were WorkspaceFile et al.) ----

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsFile {
    path: String, // forward-slash workspace-relative
    size: u64,
    mtime: u64,
}

#[derive(Serialize)]
struct OpenResult {
    root: String,
    files: Vec<WsFile>,
}

#[derive(Serialize)]
struct CmdResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn cmd_ok() -> CmdResult {
    CmdResult {
        ok: true,
        error: None,
    }
}
fn cmd_err(e: impl std::fmt::Display) -> CmdResult {
    CmdResult {
        ok: false,
        error: Some(e.to_string()),
    }
}

// ---- PathRel: exact port of box-core isPathRel/resolveInside ----
// forward slashes only, no "..", no ".", no drive letters, no forbidden
// chars, no control chars, no segment ending in "." or space.

const FORBIDDEN: &[char] = &['<', '>', ':', '"', '\\', '|', '?', '*'];

// Windows device names are illegal file stems on Windows no matter the
// extension (con.txt, nul.png both fail there) but legal on macOS/Linux -
// a workspace authored there must never mint names Windows can't open.
const RESERVED_STEMS: &[&str] = &[
    "con", "prn", "aux", "nul", "clock$", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
    "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn is_path_rel(p: &str) -> bool {
    if p.is_empty() {
        return false;
    }
    let b = p.as_bytes();
    if p.starts_with('/') || p.starts_with('\\') {
        return false;
    }
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return false; // drive letter
    }
    if p.ends_with('/') || p.ends_with('\\') {
        return false;
    }
    if p.contains('\\') {
        return false;
    }
    if p.chars().any(|c| FORBIDDEN.contains(&c) || c < ' ') {
        return false;
    }
    let segs: Vec<&str> = p.split('/').collect();
    if segs.iter().any(|s| s.is_empty() || *s == "." || *s == "..") {
        return false;
    }
    if segs.iter().any(|s| s.ends_with('.') || s.ends_with(' ')) {
        return false;
    }
    true
}

// fs::canonicalize returns \\?\ verbatim paths on Windows; ShellExecute
// and Explorer reject those, so strip the prefix for ordinary drive
// paths (UNC shares keep it - they need it).
fn simplify_verbatim(p: PathBuf) -> PathBuf {
    let s = p.as_os_str().to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if !rest.starts_with(r"UNC\") {
            return PathBuf::from(rest);
        }
    }
    p
}

fn resolve_inside(root: &Path, rel: &str) -> Option<PathBuf> {
    if !is_path_rel(rel) {
        return None;
    }
    let candidate = root.join(rel.split('/').collect::<PathBuf>());
    // Lexical containment is not enough: a symlink or junction inside the
    // workspace can point outside it, and is_path_rel cannot see that.
    // Canonicalize the deepest existing ancestor - covering both existing
    // targets and not-yet-created write paths - re-append the missing
    // tail, and require the result to stay under the canonical root.
    // TOCTOU residual: a local attacker racing a symlink swap between
    // check and use is out of scope for a single-user local app.
    let canon_root = simplify_verbatim(fs::canonicalize(root).ok()?);
    let mut ancestor = candidate.as_path();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(canon) = fs::canonicalize(ancestor) {
            let mut resolved = simplify_verbatim(canon);
            for seg in tail.iter().rev() {
                resolved.push(seg);
            }
            return resolved.starts_with(&canon_root).then_some(resolved);
        }
        let name = ancestor.file_name()?;
        tail.push(name.to_os_string());
        ancestor = ancestor.parent()?;
    }
}

// ---- scan (port of scanDir) ----

const SKIP_DIRS: &[&str] = &[".box/tmp", "node_modules", ".git"];

fn scan_dir(root: &Path, rel: &str, out: &mut Vec<WsFile>) {
    let dir = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let rel_path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let ft = match e.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_dir() {
            if !SKIP_DIRS.contains(&rel_path.as_str()) {
                scan_dir(root, &rel_path, out);
            }
        } else if ft.is_file() {
            if let Ok(md) = e.metadata() {
                let mtime = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(WsFile {
                    path: rel_path,
                    size: md.len(),
                    mtime,
                });
            }
        }
    }
}

// ---- atomic write / trash / tombstone ledger ----
// Ported from storytold/craft-libs crates/atomic (Apache-2.0 OR MIT):
// fsync the staged file BEFORE the rename (sync_file < rename ordering),
// then retry the rename on Windows while AV/indexer/backup tools hold a
// transient share lock (ERROR_SHARING_VIOLATION/ERROR_LOCK_VIOLATION,
// PermissionDenied) with 10ms doubling backoff capped at 200ms.

const MAX_RETRY_DELAY_MS: u64 = 200;

fn is_transient_lock(e: &std::io::Error) -> bool {
    const ERROR_SHARING_VIOLATION: i32 = 32;
    const ERROR_LOCK_VIOLATION: i32 = 33;
    e.kind() == std::io::ErrorKind::PermissionDenied
        || (cfg!(windows)
            && matches!(
                e.raw_os_error(),
                Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION)
            ))
}

fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    // Windows-only backoff; other platforms take the single-attempt path.
    let mut delay_ms: u64 = if cfg!(windows) { 10 } else { 0 };
    let mut left: u32 = if cfg!(windows) { 7 } else { 0 };
    loop {
        match fs::rename(from, to) {
            Err(e) if is_transient_lock(&e) && left > 0 => {
                left -= 1;
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                delay_ms = delay_ms.saturating_mul(2).min(MAX_RETRY_DELAY_MS);
            }
            r => return r,
        }
    }
}

fn write_atomic(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    write_atomic_bytes(root, rel, content.as_bytes())
}

fn write_atomic_bytes(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let abs = resolve_inside(root, rel).ok_or("path escapes workspace")?;
    let tmp_dir = root.join(".box").join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let tmp = tmp_dir.join(format!("w-{}.tmp", uuid()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut f, bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if let Err(e) = rename_with_retry(&tmp, &abs) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

/// Housekeeping for `.box`, run once per workspace open.
///
/// - `.box/tmp`: atomic-write temps (`w-*.tmp`) orphaned by a crash are
///   swept once they are a day old; younger files may belong to a live write.
/// - `.box/thumbs`: the derived thumbnail cache is capped so a large or
///   long-lived workspace cannot grow it without bound; oldest evicted.
///
/// Name filters keep foreign files inside `.box` untouched. All failures
/// are silent - a dirty cache dir is not fatal to opening a workspace.
fn gc_box_dirs(root: &Path) {
    let tmp_dir = root.join(".box").join("tmp");
    let cutoff = std::time::SystemTime::now() - Duration::from_secs(24 * 3600);
    if let Ok(rd) = fs::read_dir(&tmp_dir) {
        for e in rd.flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            if !(name.starts_with("w-") && name.ends_with(".tmp")) {
                continue;
            }
            let stale = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| t < cutoff)
                .unwrap_or(false);
            if stale {
                let _ = fs::remove_file(e.path());
            }
        }
    }

    const THUMB_CAP: usize = 512;
    let thumbs = root.join(".box").join("thumbs");
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    if let Ok(rd) = fs::read_dir(&thumbs) {
        for e in rd.flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            if !(name.starts_with("thumb-") && name.ends_with(".png")) {
                continue;
            }
            if let Ok(md) = e.metadata() {
                if md.is_file() {
                    entries.push((e.path(), md.modified().unwrap_or(std::time::UNIX_EPOCH)));
                }
            }
        }
    }
    let excess = entries.len().saturating_sub(THUMB_CAP);
    if excess > 0 {
        entries.sort_by_key(|(_, t)| *t);
        for (p, _) in entries.into_iter().take(excess) {
            let _ = fs::remove_file(p);
        }
    }
}

fn uuid() -> String {
    // RFC4122 v4 from system rng-free entropy: timestamp + counter + pid.
    // Collision odds inside .box/tmp are what matter (same-ms, same pid).
    use std::sync::atomic::{AtomicU64, Ordering};
    static CTR: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(
        "{:x}-{:x}-{:x}",
        t,
        CTR.fetch_add(1, Ordering::Relaxed),
        std::process::id()
    )
}

pub const TOMBSTONE_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days per DATA-MODEL §4.3 & ADR-0011

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct TombstoneRecord {
    #[serde(rename = "edgeId")]
    pub edge_id: String,
    pub at: u64,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum RawTombstone {
    Legacy(String),
    Record {
        #[serde(rename = "edgeId")]
        edge_id: String,
        at: Option<u64>,
    },
}

fn append_tombstone(root: &Path, edge_id: &str) -> Result<(), String> {
    let rel = ".box/tombstones.json";
    let abs = resolve_inside(root, rel).ok_or("path escapes workspace")?;
    // Only a missing or undecodable ledger starts fresh. Any other read
    // failure (AV/indexer share lock, permissions) must NOT fall through to
    // an empty list: the write below would clobber every recorded tombstone
    // and deleted arrows would resurrect on the next reconcile (DATA-MODEL 4.3).
    let raw = match fs::read_to_string(&abs) {
        Ok(s) => s,
        Err(e)
            if e.kind() == std::io::ErrorKind::NotFound
                || e.kind() == std::io::ErrorKind::InvalidData =>
        {
            "[]".into()
        }
        Err(e) => return Err(format!("tombstone ledger unreadable: {e}")),
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let raw_entries: Vec<RawTombstone> = serde_json::from_str(&raw).unwrap_or_default();
    let mut records: Vec<TombstoneRecord> = raw_entries
        .into_iter()
        .filter_map(|entry| match entry {
            RawTombstone::Legacy(id) if !id.is_empty() => Some(TombstoneRecord {
                edge_id: id,
                at: now,
            }),
            RawTombstone::Record { edge_id, at } if !edge_id.is_empty() => {
                let entry_at = at.unwrap_or(now);
                if now.saturating_sub(entry_at) <= TOMBSTONE_TTL_MS {
                    Some(TombstoneRecord {
                        edge_id,
                        at: entry_at,
                    })
                } else {
                    None
                }
            }
            _ => None,
        })
        .collect();

    if let Some(existing) = records.iter_mut().find(|r| r.edge_id == edge_id) {
        existing.at = now;
    } else {
        records.push(TombstoneRecord {
            edge_id: edge_id.to_string(),
            at: now,
        });
    }

    records.sort_by(|a, b| a.edge_id.cmp(&b.edge_id));

    let formatted = serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?;
    write_atomic(root, rel, &format!("{formatted}\n"))
}

// ---- MIME (same deliberate map as the Electron handler) ----

fn mime_for(rel: &str) -> &'static str {
    let ext = rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "pdf" => "application/pdf",
        "md" => "text/markdown; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

// ---- app state ----

struct WatchGuard {
    _watcher: RecommendedWatcher,
}

struct AppState {
    workspace_root: Mutex<Option<PathBuf>>,
    watch: Mutex<Option<WatchGuard>>,
}

// session file: userData/box-session.json (same contract as Electron build)
fn session_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("box-session.json"))
}

fn save_last_workspace(app: &AppHandle, root: &str) {
    if let Some(f) = session_file(app) {
        if let Some(parent) = f.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(
            f,
            format!(
                "{{\"lastWorkspace\":{}}}\n",
                serde_json::to_string(root).unwrap()
            ),
        );
    }
}

// ---- commands (the window.box surface) ----

#[tauri::command]
fn scan(root: String) -> Vec<WsFile> {
    let mut out = Vec::new();
    scan_dir(Path::new(&root), "", &mut out);
    out
}

#[tauri::command]
fn open_workspace(app: AppHandle, state: State<'_, AppState>) -> Option<OpenResult> {
    let picked = rfd::FileDialog::new()
        .set_title("Open a folder as a Box workspace")
        .pick_folder()?;
    let root = picked.to_string_lossy().replace('\\', "/");
    *state.workspace_root.lock().unwrap() = Some(picked.clone());
    save_last_workspace(&app, &root);
    let mut files = Vec::new();
    scan_dir(&picked, "", &mut files);
    Some(OpenResult { root, files })
}

#[tauri::command]
fn last_workspace(app: AppHandle) -> Option<String> {
    let f = session_file(&app)?;
    let raw = fs::read_to_string(f).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let p = v.get("lastWorkspace")?.as_str()?;
    let pb = PathBuf::from(p);
    if pb.is_dir() {
        Some(p.to_string())
    } else {
        None
    }
}

const DEBOUNCE: Duration = Duration::from_millis(150);
// DATA-MODEL 5.2: the quiet window extends while events keep arriving but is
// capped, so a sustained stream (long copy, render writing into the workspace)
// still refreshes the canvas instead of starving it forever.
const DEBOUNCE_MAX: Duration = Duration::from_secs(2);

/// Coalesce raw fs events into one `emit` per quiet window. A burst is
/// flushed after `quiet` of silence OR once it has run `max`, whichever
/// comes first; a continuing stream then starts the next burst.
fn debounce_events<T>(rx: &Receiver<T>, quiet: Duration, max: Duration, mut emit: impl FnMut()) {
    loop {
        match rx.recv_timeout(quiet) {
            Ok(_) => {
                let burst_start = Instant::now();
                loop {
                    let left = max.saturating_sub(burst_start.elapsed());
                    if left.is_zero() {
                        emit();
                        break;
                    }
                    match rx.recv_timeout(quiet.min(left)) {
                        Ok(_) => continue,
                        Err(RecvTimeoutError::Timeout) => {
                            emit();
                            break;
                        }
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

#[tauri::command]
fn watch(app: AppHandle, state: State<'_, AppState>, root: String) -> CmdResult {
    let root_pb = PathBuf::from(&root);
    *state.workspace_root.lock().unwrap() = Some(root_pb.clone());
    save_last_workspace(&app, &root);
    gc_box_dirs(&root_pb);

    let (tx, rx) = channel();
    let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
        Ok(w) => w,
        Err(e) => return cmd_err(e),
    };
    if let Err(e) = watcher.watch(&root_pb, RecursiveMode::Recursive) {
        return cmd_err(e);
    }

    // Debounce: emit one "box:fs-dirty" per quiet window, not per event.
    let app2 = app.clone();
    std::thread::spawn(move || {
        debounce_events(&rx, DEBOUNCE, DEBOUNCE_MAX, || {
            let _ = app2.emit("box:fs-dirty", ());
        });
    });

    *state.watch.lock().unwrap() = Some(WatchGuard { _watcher: watcher });
    cmd_ok()
}

#[tauri::command]
fn unwatch(state: State<'_, AppState>) -> CmdResult {
    *state.watch.lock().unwrap() = None;
    cmd_ok()
}

// Defense in depth: once a session root exists (open_workspace/watch),
// every fs_* command must name that root - renderer bugs or injected IPC
// can't aim primitives at arbitrary dirs. Pre-session (restore flow calls
// rescan before watch), a caller root must at least be a real directory.
fn bound_root(state: &AppState, caller: &str) -> Result<PathBuf, CmdResult> {
    let caller_pb = PathBuf::from(caller);
    let guard = state.workspace_root.lock().unwrap();
    match &*guard {
        Some(session) if *session == caller_pb => Ok(session.clone()),
        Some(_) => Err(cmd_err("root is not the active workspace")),
        None if caller_pb.is_dir() => Ok(caller_pb),
        None => Err(cmd_err("root is not a directory")),
    }
}

#[tauri::command]
fn fs_read(state: State<'_, AppState>, root: String, rel: String) -> Option<String> {
    let root = bound_root(&state, &root).ok()?;
    let abs = resolve_inside(&root, &rel)?;
    let bytes = fs::read(abs).ok()?;
    // Node's readFile(path, "utf8") lossy-decodes (U+FFFD) rather than
    // failing - match that or binary files read differently vs Electron.
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn fs_read_batch(
    state: State<'_, AppState>,
    root: String,
    rels: Vec<String>,
) -> HashMap<String, Option<String>> {
    let mut out = HashMap::with_capacity(rels.len());
    let Ok(root_pb) = bound_root(&state, &root) else {
        for rel in rels {
            out.insert(rel, None);
        }
        return out;
    };
    for rel in rels {
        let content = resolve_inside(&root_pb, &rel)
            .and_then(|abs| fs::read(abs).ok())
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
        out.insert(rel, content);
    }
    out
}

#[tauri::command]
fn fs_write_atomic(
    state: State<'_, AppState>,
    root: String,
    rel: String,
    content: String,
) -> CmdResult {
    match bound_root(&state, &root).and_then(|r| write_atomic(&r, &rel, &content).map_err(cmd_err))
    {
        Ok(()) => cmd_ok(),
        Err(e) => e,
    }
}

#[tauri::command]
fn fs_trash(state: State<'_, AppState>, root: String, rel: String) -> CmdResult {
    let root = match bound_root(&state, &root) {
        Ok(r) => r,
        Err(e) => return e,
    };
    match resolve_inside(&root, &rel) {
        None => cmd_err("path escapes workspace"),
        Some(abs) => match trash::delete(&abs) {
            Ok(()) => cmd_ok(),
            Err(e) => cmd_err(e),
        },
    }
}

#[tauri::command]
fn fs_append_tombstone(state: State<'_, AppState>, root: String, edge_id: String) -> CmdResult {
    // The edge-id contract is 16 lowercase hex (box-core ids.rs); garbage
    // in the ledger would wedge reconcile's tombstone lookups forever.
    let valid = edge_id.len() == 16
        && edge_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    if !valid {
        return cmd_err(format!("edge_id not 16-hex: {edge_id}"));
    }
    match bound_root(&state, &root).and_then(|r| append_tombstone(&r, &edge_id).map_err(cmd_err)) {
        Ok(()) => cmd_ok(),
        Err(e) => e,
    }
}

#[tauri::command]
fn open_external(state: State<'_, AppState>, rel: String) -> CmdResult {
    let root = match state.workspace_root.lock().unwrap().clone() {
        Some(r) => r,
        None => return cmd_err("no workspace"),
    };
    match resolve_inside(&root, &rel) {
        None => cmd_err(format!("path escapes workspace: {rel}")),
        Some(abs) => match opener::open(&abs) {
            Ok(()) => cmd_ok(),
            Err(e) => cmd_err(e),
        },
    }
}

#[tauri::command]
fn reveal_file(state: State<'_, AppState>, rel: String) -> CmdResult {
    let root = match state.workspace_root.lock().unwrap().clone() {
        Some(r) => r,
        None => return cmd_err("no workspace"),
    };
    match resolve_inside(&root, &rel) {
        None => cmd_err(format!("path escapes workspace: {rel}")),
        Some(abs) => match opener::reveal(&abs) {
            Ok(()) => cmd_ok(),
            Err(e) => cmd_err(e),
        },
    }
}

#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}

// In-app "Report an issue": opens the project tracker in the default
// browser. The URL is allowlisted to this repo's issues area - a generic
// open-any-URL command would be an unexpected remote-triggerable surface.
#[tauri::command]
fn open_url(url: String) -> CmdResult {
    const ALLOWED: &str = "https://github.com/theCosmicCrafter/the-box/issues";
    if !url.starts_with(ALLOWED) {
        return cmd_err("url outside allowed issues area");
    }
    match opener::open(&url) {
        Ok(()) => cmd_ok(),
        Err(e) => cmd_err(e),
    }
}

// FR-305 "Open with": the user picks an app per extension; the chosen exe
// gets the workspace file as its argv[1] (per Old New Thing: programs that
// open files accept a quoted path arg - ShellExecute's open verb does the
// same resolution). The app path is user-picked and legitimately outside
// the workspace root - only `rel` is containment-checked.
fn valid_open_with_app(app: &str) -> bool {
    let p = Path::new(app);
    p.is_absolute() && p.is_file()
}

#[tauri::command]
fn fs_open_with(state: State<'_, AppState>, rel: String, app: String) -> CmdResult {
    let root = match state.workspace_root.lock().unwrap().clone() {
        Some(r) => r,
        None => return cmd_err("no workspace"),
    };
    if !valid_open_with_app(&app) {
        return cmd_err("open-with app must be an existing absolute path");
    }
    match resolve_inside(&root, &rel) {
        None => cmd_err(format!("path escapes workspace: {rel}")),
        Some(abs) => match std::process::Command::new(app).arg(&abs).spawn() {
            Ok(_) => cmd_ok(),
            Err(e) => cmd_err(e),
        },
    }
}

#[tauri::command]
fn pick_app() -> Option<String> {
    let mut d = rfd::FileDialog::new().set_title("Choose an application");
    if cfg!(windows) {
        d = d.add_filter("Applications", &["exe"]);
    }
    d.pick_file()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

// ---- import / create / pick (drag-drop + context-menu verbs) ----

// Files arriving from outside (OS drag-drop, file picker) are COPIED into
// the workspace - nodes may only point at workspace-rel paths, and
// files-are-truth means no symlinks or external references.
#[derive(Serialize)]
struct ImportResult {
    ok: bool,
    imported: Vec<ImportedFile>,
    skipped: Vec<SkippedFile>,
}
#[derive(Serialize)]
struct ImportedFile {
    rel: String,
    src: String,
}
#[derive(Serialize)]
struct SkippedFile {
    src: String,
    reason: String,
}
#[derive(Serialize)]
struct FileResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn session_root(state: &AppState) -> Result<PathBuf, CmdResult> {
    state
        .workspace_root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| cmd_err("no workspace open"))
}

// A filename dragged in from the OS can contain chars PathRel rejects
// (':', '|', controls, trailing dots). Import sanitizes rather than
// rejecting - the user's file lands under a cleaned name.
fn sanitize_filename(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || c < ' ' || c == '/' {
                '-'
            } else {
                c
            }
        })
        .collect();
    while out.ends_with('.') || out.ends_with(' ') {
        out.pop();
    }
    if out.is_empty() || out == "." || out == ".." {
        out = "file".to_string();
    }
    let stem = out.split('.').next().unwrap_or("");
    if RESERVED_STEMS.contains(&stem.to_ascii_lowercase().as_str()) {
        out = format!("file-{out}");
    }
    out.truncate(180); // stay comfortably under NTFS 255
    out
}

fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]), // ext includes the dot
        _ => (name, ""),
    };
    for i in 0..9999u32 {
        let cand = if i == 0 {
            name.to_string()
        } else {
            format!("{stem}-{i}{ext}")
        };
        let p = dir.join(&cand);
        if !p.exists() {
            return p;
        }
    }
    dir.join(format!("{stem}-{}{ext}", uuid()))
}

// Copy src into `root` at top level; returns the workspace-rel path.
// A src already inside the workspace resolves to its existing rel path -
// dragging a file from an Explorer window of the workspace must not
// duplicate it.
fn import_one(root: &Path, src: &Path) -> Result<String, String> {
    let canon_src = src.canonicalize().map_err(|e| format!("unreadable: {e}"))?;
    if canon_src.is_dir() {
        return Err("is a directory".into());
    }
    if !canon_src.is_file() {
        return Err("not a regular file".into());
    }
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
    if let Ok(rel) = canon_src.strip_prefix(&canon_root) {
        return Ok(rel.to_string_lossy().replace('\\', "/"));
    }
    let name = sanitize_filename(&src.file_name().unwrap_or_default().to_string_lossy());
    let dest = unique_dest(root, &name);
    fs::copy(&canon_src, &dest).map_err(|e| e.to_string())?;
    Ok(dest
        .strip_prefix(root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
fn import_files(state: State<'_, AppState>, paths: Vec<String>) -> ImportResult {
    let root = match session_root(&state) {
        Ok(r) => r,
        Err(_) => {
            return ImportResult {
                ok: false,
                imported: vec![],
                skipped: paths
                    .iter()
                    .map(|p| SkippedFile {
                        src: p.clone(),
                        reason: "no workspace open".into(),
                    })
                    .collect(),
            }
        }
    };
    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    for p in paths {
        match import_one(&root, Path::new(&p)) {
            Ok(rel) => imported.push(ImportedFile { rel, src: p }),
            Err(reason) => skipped.push(SkippedFile { src: p, reason }),
        }
    }
    ImportResult {
        ok: true,
        imported,
        skipped,
    }
}

// create_new semantics: picks stem.ext / stem-1.ext / ... under dir and
// fails rather than overwrite - "New document" must never clobber an
// existing file with a guessed name.
fn create_new(
    root: &Path,
    dir_rel: &str,
    stem: &str,
    ext: &str,
    bytes: &[u8],
) -> Result<String, String> {
    if !(dir_rel.is_empty() || is_path_rel(dir_rel)) {
        return Err("bad dir".into());
    }
    let dir = if dir_rel.is_empty() {
        root.to_path_buf()
    } else {
        resolve_inside(root, dir_rel).ok_or("bad dir")?
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem_s = sanitize_filename(stem);
    let ext_s: String = ext
        .trim_start_matches('.')
        .chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || c < ' ' || c == '/' {
                '-'
            } else {
                c
            }
        })
        .collect();
    for i in 0..9999u32 {
        // Empty ext must not leave a trailing dot - "name." is an illegal
        // Windows filename and create_new() would fail.
        let name = if ext_s.is_empty() {
            if i == 0 {
                stem_s.clone()
            } else {
                format!("{stem_s}-{i}")
            }
        } else if i == 0 {
            format!("{stem_s}.{ext_s}")
        } else {
            format!("{stem_s}-{i}.{ext_s}")
        };
        let p = dir.join(&name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&p)
        {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(bytes).map_err(|e| e.to_string())?;
                let rel = if dir_rel.is_empty() {
                    name.clone()
                } else {
                    format!("{dir_rel}/{name}")
                };
                return Ok(rel);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("no free filename".into())
}

#[tauri::command]
fn new_text_file(
    state: State<'_, AppState>,
    dir: String,
    stem: String,
    ext: String,
    content: String,
) -> FileResult {
    match session_root(&state)
        .and_then(|r| create_new(&r, &dir, &stem, &ext, content.as_bytes()).map_err(cmd_err))
    {
        Ok(path) => FileResult {
            ok: true,
            path: Some(path),
            error: None,
        },
        Err(e) => FileResult {
            ok: false,
            path: None,
            error: e.error,
        },
    }
}

#[tauri::command]
fn new_binary_file(
    state: State<'_, AppState>,
    dir: String,
    stem: String,
    ext: String,
    b64: String,
) -> FileResult {
    use base64::Engine;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(&b64) {
        Ok(b) => b,
        Err(e) => {
            return FileResult {
                ok: false,
                path: None,
                error: Some(format!("bad base64: {e}")),
            }
        }
    };
    match session_root(&state)
        .and_then(|r| create_new(&r, &dir, &stem, &ext, &bytes).map_err(cmd_err))
    {
        Ok(path) => FileResult {
            ok: true,
            path: Some(path),
            error: None,
        },
        Err(e) => FileResult {
            ok: false,
            path: None,
            error: e.error,
        },
    }
}

// Ctrl+D duplicate: workspace file copied to `<stem>-copy[-N].<ext>` in the
// same folder (files-are-truth - duplicating an object duplicates its file).
fn fs_copy_inner(root: &Path, rel: &str) -> Result<String, String> {
    if !is_path_rel(rel) {
        return Err("bad path".into());
    }
    let src = resolve_inside(root, rel).ok_or("bad path")?;
    if !src.is_file() {
        return Err("not a file".into());
    }
    let bytes = fs::read(&src).map_err(|e| e.to_string())?;
    let parent = rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let name = rel.rsplit('/').next().unwrap_or(rel);
    // Dotfiles (".env") and extensionless names keep no extension - a
    // synthetic ".bin" would be wrong for both. Node path.extname parity.
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), e.to_string()),
        _ => (name.to_string(), String::new()),
    };
    create_new(root, parent, &format!("{stem}-copy"), &ext, &bytes)
}

// OS-native icon fallback for typed tiles (unparseable binaries like
// .blend/.c4d/.dwg get the shell-associated icon instead of a generic
// glyph). PNGs cache under .box/icons - derived data, safe to delete.
// Key is FNV-1a over the rel path: deterministic across runs (std's
// DefaultHasher is not) and collision-safe enough for a rebuildable cache.
fn fnv64(s: &str) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn file_icon_inner(root: &Path, rel: &str) -> Result<String, String> {
    if !is_path_rel(rel) {
        return Err("bad path".into());
    }
    let src = resolve_inside(root, rel).ok_or("bad path")?;
    if !src.is_file() {
        return Err("not a file".into());
    }
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let png = systemicons::get_icon(name, 64).map_err(|e| format!("icon: {e:?}"))?;
    if png.len() < 8 || &png[..4] != b"\x89PNG" {
        return Err("icon: not a png".into());
    }
    // Shell association is per-extension - cache per ext so 500 same-type
    // files share one PNG. exe/lnk/ico embed their own icon: per-path.
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase());
    let per_file = matches!(ext.as_deref(), Some("exe" | "lnk" | "ico"));
    let key = if per_file {
        rel
    } else {
        ext.as_deref().unwrap_or(name)
    };
    let dir = root.join(".box").join("icons");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out_rel = format!(".box/icons/icon-{:016x}.png", fnv64(key));
    let out = resolve_inside(root, &out_rel).ok_or("bad path")?;
    if !out.exists() {
        write_atomic_bytes(root, &out_rel, &png)?;
    }
    Ok(out_rel)
}

#[tauri::command]
fn file_icon(state: State<'_, AppState>, rel: String) -> FileResult {
    let run = session_root(&state).and_then(|root| file_icon_inner(&root, &rel).map_err(cmd_err));
    match run {
        Ok(path) => FileResult {
            ok: true,
            path: Some(path),
            error: None,
        },
        Err(e) => FileResult {
            ok: false,
            path: None,
            error: e.error,
        },
    }
}

// Shell thumbnail for formats without a JS decoder: video frames, HEIC,
// CR3 and anything a Windows codec/extension can thumbnail (Explorer's
// IShellItemImageFactory). Cached PNG under .box/thumbs - derived cache.
// Non-Windows hosts return Err and the tile falls back to the icon lane.
#[cfg(target_os = "windows")]
fn shell_thumb_png(abs: &Path, px: i32) -> Result<Vec<u8>, String> {
    use std::cell::Cell;
    use windows::core::*;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Shell::*;

    thread_local! {
        static COM_INIT: Cell<bool> = const { Cell::new(false) };
    }
    unsafe {
        if !COM_INIT.get() {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|e| format!("com: {e}"))?;
            COM_INIT.set(true);
        }
        // Shell APIs reject \\?\ verbatim paths - strip what canonicalize()
        // added, and normalize slashes (resolve_inside canonicalizes).
        let raw = abs.to_string_lossy().replace('/', "\\");
        let shell_path = if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else {
            raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
        };
        let wide: Vec<u16> = shell_path
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
                .map_err(|e| format!("shellitem: {e}"))?;
        // THUMBNAILONLY, not BIGGERSIZEOK: without it the shell returns the
        // file's icon as a bitmap for everything, which duplicates the
        // (sharper) icon lane and wastes cache. Err = no real thumbnail.
        let hbmp = factory
            .GetImage(SIZE { cx: px, cy: px }, SIIGBF_THUMBNAILONLY)
            .map_err(|e| format!("thumb: {e}"))?;
        let mut bmp = BITMAP::default();
        if GetObjectW(
            hbmp,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        ) == 0
        {
            let _ = DeleteObject(hbmp);
            return Err("bitmap info failed".into());
        }
        let (w, h) = (bmp.bmWidth, bmp.bmHeight);
        if w <= 0 || h <= 0 {
            let _ = DeleteObject(hbmp);
            return Err("empty thumb".into());
        }
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let dc = GetDC(None);
        let rows = GetDIBits(
            dc,
            hbmp,
            0,
            h as u32,
            Some(buf.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, dc);
        let _ = DeleteObject(hbmp);
        if rows == 0 {
            return Err("getdibits failed".into());
        }
        // BGRA -> RGBA. Alpha: premultiplied vs straight varies by codec;
        // if every alpha is 0 the source had none - force opaque.
        let mut max_a = 0u8;
        for i in (3..buf.len()).step_by(4) {
            max_a = max_a.max(buf[i]);
        }
        for px in buf.as_chunks_mut::<4>().0.iter_mut() {
            px.swap(0, 2);
            px[3] = if max_a == 0 { 255 } else { px[3] };
        }
        let img = image::RgbaImage::from_raw(w as u32, h as u32, buf).ok_or("image build")?;
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(out)
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_thumb_png(_abs: &Path, _px: i32) -> Result<Vec<u8>, String> {
    Err("shell thumbnails are Windows-only for now".into())
}

fn file_thumb_inner(root: &Path, rel: &str) -> Result<String, String> {
    if !is_path_rel(rel) {
        return Err("bad path".into());
    }
    let src = resolve_inside(root, rel).ok_or("bad path")?;
    if !src.is_file() {
        return Err("not a file".into());
    }
    // mtime keys the cache: a re-saved file must re-thumbnail.
    let mtime = src
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let out_rel = format!(
        ".box/thumbs/thumb-{:016x}.png",
        fnv64(&format!("{rel}@{mtime}"))
    );
    let out = resolve_inside(root, &out_rel).ok_or("bad path")?;
    if out.exists() {
        return Ok(out_rel);
    }
    let png = shell_thumb_png(&src, 512)?;
    let dir = root.join(".box").join("thumbs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic_bytes(root, &out_rel, &png)?;
    Ok(out_rel)
}

#[tauri::command]
fn file_thumb(state: State<'_, AppState>, rel: String) -> FileResult {
    let run = session_root(&state).and_then(|root| file_thumb_inner(&root, &rel).map_err(cmd_err));
    match run {
        Ok(path) => FileResult {
            ok: true,
            path: Some(path),
            error: None,
        },
        Err(e) => FileResult {
            ok: false,
            path: None,
            error: e.error,
        },
    }
}

// ADR-0010: Stage-4 decision calls route through Rust because the
// webview CSP connect-src blocks outbound http by design. The command
// allowlists loopback hosts only - the zero-cloud rule lives in
// platform code, not in a flag a setting could forget.
fn is_loopback_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    // The authority ends at the first '/', '?' or '#'. Only the authority
    // may name the host: a prefix match on the raw string is bypassable
    // with userinfo (`http://127.0.0.1:8770@evil.com/` connects to evil.com).
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    if authority.contains('@') || authority.contains('\\') {
        return false;
    }
    let host_end = if authority.starts_with('[') {
        match authority.find(']') {
            Some(i) => i + 1,
            None => return false,
        }
    } else {
        authority.find(':').unwrap_or(authority.len())
    };
    let (host, tail) = authority.split_at(host_end);
    let port_ok = match tail.strip_prefix(':') {
        None => tail.is_empty(),
        Some(p) => !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()),
    };
    port_ok && (host == "127.0.0.1" || host == "[::1]" || host.eq_ignore_ascii_case("localhost"))
}

// decide_post is the renderer's only network egress (CSP connect-src blocks
// http in the webview). Loopback-only is enforced above; these caps stop a
// buggy renderer or hostile local service from turning it into a memory
// pump - requests are small decision payloads, responses are JSON answers.
const DECIDE_MAX_REQUEST: usize = 256 * 1024;
const DECIDE_MAX_RESPONSE: u64 = 1024 * 1024;

#[tauri::command]
fn decide_post(url: String, body: String) -> Result<String, String> {
    if !is_loopback_url(&url) {
        return Err("decide_post: non-loopback url refused".to_string());
    }
    if body.len() > DECIDE_MAX_REQUEST {
        return Err("decide_post: request body too large".to_string());
    }
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(5)))
        .build();
    let agent = ureq::Agent::new_with_config(config);
    let mut res = agent
        .post(&url)
        .content_type("application/json")
        .send(body.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut limited = res.body_mut().as_reader().take(DECIDE_MAX_RESPONSE + 1);
    let mut buf = String::new();
    limited
        .read_to_string(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() as u64 > DECIDE_MAX_RESPONSE {
        return Err("decide_post: response too large".to_string());
    }
    Ok(buf)
}

#[tauri::command]
fn fs_copy(state: State<'_, AppState>, rel: String) -> FileResult {
    let run = session_root(&state).and_then(|root| fs_copy_inner(&root, &rel).map_err(cmd_err));
    match run {
        Ok(path) => FileResult {
            ok: true,
            path: Some(path),
            error: None,
        },
        Err(e) => FileResult {
            ok: false,
            path: None,
            error: e.error,
        },
    }
}

// Native multi-picker feeding import_files (drag-drop's keyboard cousin).
#[tauri::command]
fn pick_files(images_only: bool) -> Vec<String> {
    let mut d = rfd::FileDialog::new().set_title("Import into workspace");
    if images_only {
        d = d.add_filter(
            "Images",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "avif", "tif", "tiff", "bmp", "svg", "exr",
                "hdr", "dng", "raw",
            ],
        );
    }
    d.pick_files()
        .unwrap_or_default()
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

// ---- box:// media protocol (port of the Electron protocol.handle) ----
// box://f/<percent-encoded rel path>[?v=<mtime>] on macOS/iOS/Linux;
// https://box.localhost/f/<...> on Windows (WebView2 custom-scheme shape).
// Range requests get 206 partial streams - required for media seeking.

// Largest single range we will buffer. Tauri protocol bodies are bytes,
// not streams, so an uncapped `bytes=0-` on a huge file would be a memory
// bomb - clamp served ranges instead (media clients issue incremental
// ranges, so nothing visible breaks).
const MAX_RANGE_BYTES: u64 = 64 * 1024 * 1024;
// Full-body cap for the no-Range path, same reasoning.
const MAX_BODY_BYTES: u64 = 512 * 1024 * 1024;

fn mime_and_body(
    abs: &Path,
    range: Option<&str>,
) -> Result<tauri::http::Response<Cow<'static, [u8]>>, String> {
    let mut f = fs::File::open(abs).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let mime = mime_for(abs.to_string_lossy().as_ref());

    let b = tauri::http::Response::builder()
        .header("Content-Type", mime)
        .header("Access-Control-Allow-Origin", "*")
        .header("Accept-Ranges", "bytes");

    if let Some(rh) = range {
        let ranges = match http_range::HttpRange::parse(rh, len) {
            Ok(r) => r,
            // RFC 7233: unsatisfiable != malformed. NoOverlap must be 416
            // (media scrubbing past EOF depends on it); malformed -> Err.
            Err(http_range::HttpRangeParseError::NoOverlap) => {
                return Ok(b
                    .status(416)
                    .header("Content-Range", format!("bytes */{len}"))
                    .body(Cow::Borrowed(&[][..]))
                    .unwrap());
            }
            Err(_) => return Err("bad range".into()),
        };
        // Ok(empty) means the header parsed but named no ranges ("bytes=")
        // - malformed syntax, not an unsatisfiable range. -> Err -> 404.
        if ranges.is_empty() {
            return Err("bad range".into());
        }
        let r = &ranges[0];
        let start = r.start;
        let mut end = r.start + r.length - 1;
        end = end.min(len.saturating_sub(1));
        end = end.min(start + MAX_RANGE_BYTES - 1);
        if start >= len || end < start {
            return Ok(b
                .status(416)
                .header("Content-Range", format!("bytes */{len}"))
                .body(Cow::Borrowed(&[][..]))
                .unwrap());
        }
        let mut buf = vec![0u8; (end - start + 1) as usize];
        f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        f.read_exact(&mut buf).map_err(|e| e.to_string())?;
        return Ok(b
            .status(206)
            .header("Content-Length", buf.len().to_string())
            .header("Content-Range", format!("bytes {start}-{end}/{len}"))
            .body(Cow::Owned(buf))
            .unwrap());
    }

    if len > MAX_BODY_BYTES {
        // Refuse giant full-body reads; media of this size always arrives
        // with Range headers anyway.
        return Ok(b
            .status(413)
            .header("Content-Length", "0")
            .body(Cow::Borrowed(&[][..]))
            .unwrap());
    }
    let mut buf = Vec::with_capacity(len as usize);
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(b.header("Content-Length", len.to_string())
        .body(Cow::Owned(buf))
        .unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            workspace_root: Mutex::new(None),
            watch: Mutex::new(None),
        })
        // WebView2's permission-request UI hijacks the whole webview to an
        // edge:// dialog page (observed on first Ctrl+V). Grant clipboard
        // read - paste is a first-class canvas op - and deny the rest: this
        // is a local-first app, nothing else needs a permission.
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::ClipboardRead => {
                tauri::webview::PermissionResponse::Allow
            }
            _ => tauri::webview::PermissionResponse::Deny,
        })
        .register_uri_scheme_protocol("box", move |ctx, request| {
            let root = {
                let s = ctx.app_handle().state::<AppState>();
                let r = s.workspace_root.lock().unwrap().clone();
                r
            };
            let root = match root {
                Some(r) => r,
                None => {
                    return tauri::http::Response::builder()
                        .status(404)
                        .body(Cow::Borrowed(&[][..]))
                        .unwrap()
                }
            };
            let raw_path = request.uri().path();
            let path = raw_path.split('?').next().unwrap_or(raw_path);
            let rel_enc = path
                .strip_prefix("/f/")
                .unwrap_or(path.trim_start_matches('/'));
            let rel = percent_encoding::percent_decode_str(rel_enc)
                .decode_utf8_lossy()
                .to_string();
            match resolve_inside(&root, &rel) {
                None => tauri::http::Response::builder()
                    .status(403)
                    .body(Cow::Borrowed(&[][..]))
                    .unwrap(),
                Some(abs) => {
                    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
                    match mime_and_body(&abs, range) {
                        Ok(resp) => resp,
                        Err(_) => tauri::http::Response::builder()
                            .status(404)
                            .body(Cow::Borrowed(&[][..]))
                            .unwrap(),
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan,
            open_workspace,
            last_workspace,
            watch,
            unwatch,
            fs_read,
            fs_read_batch,
            fs_write_atomic,
            fs_trash,
            fs_append_tombstone,
            open_external,
            open_url,
            reveal_file,
            fs_open_with,
            pick_app,
            platform,
            import_files,
            new_text_file,
            new_binary_file,
            fs_copy,
            file_icon,
            file_thumb,
            decide_post,
            pick_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Box");
}

// Adversarial suite lives in its own file: every boundary gets attacked,
// not demoed. `mod` + `use super::*` reaches the private security fns.
#[cfg(test)]
mod adversarial;
