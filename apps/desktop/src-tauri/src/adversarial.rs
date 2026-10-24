// SPDX-License-Identifier: LicenseRef-Proprietary
// adversarial.rs - break-it-first tests for the platform layer.
// Every test targets a documented failure mode: path escapes, protocol
// abuse, root confusion, corrupt ledger, scan leaks. A test that can't
// fail is not a test.

use super::*;

fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("box-adv-{tag}-{}", uuid()));
    fs::create_dir_all(&d).unwrap();
    d
}

// -- is_path_rel: every reject shape from the TS contract, plus more --

#[test]
fn path_rel_rejects_all_escape_shapes() {
    let bad = [
        "",
        "x/",
        "x\\",
        "/",
        "\\",
        "//x",
        "..",
        "../x",
        "a/../b",
        "a/..",
        "a/./b",
        "a//b",
        "a//",
        ".",
        "./x",
        "C:/x",
        "c:x",
        "D:\\y",
        "a\\b",
        "a\\\\b",
        "trail ",
        "trail.",
        "seg./x",
        "seg /x",
        "<x>",
        "a:b",
        "a|b",
        "a?b",
        "a*b",
        "a\"b",
        "nul\0x",
        "a\u{1f}x",
        "dir/x.md ", // trailing space inside segment-end position
    ];
    for p in bad {
        assert!(!is_path_rel(p), "should reject: {p:?}");
    }
    let good = [
        "a/b.txt",
        ".box/tombstones.json",
        "file",
        "a.b/c d.txt", // space mid-segment is legal
        "link-7f3a9c2b1d4e5f6a.md",
        "deep/nested/dir/file.png",
    ];
    for p in good {
        assert!(is_path_rel(p), "should accept: {p:?}");
    }
}

#[test]
fn resolve_inside_never_escapes() {
    let root = tmpdir("resolve");
    for p in [
        "../outside",
        "a/../../b",
        "C:/Windows/x",
        "/etc/passwd",
        "\\\\server\\share",
        ".box/../../x",
    ] {
        assert_eq!(resolve_inside(&root, p), None, "escape: {p}");
    }
    let ok = resolve_inside(&root, "a/b.txt").unwrap();
    assert!(ok.starts_with(&root));
}

// -- bound_root: session binding resists root-confusion --

#[test]
fn bound_root_rejects_foreign_roots() {
    let session_dir = tmpdir("session");
    let other_dir = tmpdir("other");
    let st = AppState {
        workspace_root: Mutex::new(Some(session_dir.clone())),
        watch: Mutex::new(None),
    };
    // caller naming a DIFFERENT real dir must be refused
    let r = bound_root(&st, &other_dir.to_string_lossy());
    assert!(r.is_err() && !r.err().unwrap().ok);
    // matching root passes
    let r = bound_root(&st, &session_dir.to_string_lossy());
    assert!(r.is_ok());
    // pre-session: real dir allowed, fake rejected
    let st2 = AppState {
        workspace_root: Mutex::new(None),
        watch: Mutex::new(None),
    };
    assert!(bound_root(&st2, &other_dir.to_string_lossy()).is_ok());
    assert!(bound_root(&st2, "C:/definitely/not/here-xyz").is_err());
}

// -- write_atomic: containment + real bytes on disk, no tmp litter --

#[test]
fn write_atomic_escapes_and_lands() {
    let root = tmpdir("atomic");
    assert!(write_atomic(&root, "../evil.txt", "x").is_err());
    assert!(write_atomic(&root, "a/b/c.txt", "hello").is_ok());
    assert_eq!(fs::read_to_string(root.join("a/b/c.txt")).unwrap(), "hello");
    // no tmp litter survives the rename
    let tmp = root.join(".box/tmp");
    assert!(fs::read_dir(&tmp).unwrap().next().is_none());
    // overwrite: rename-over-existing must work on Windows too
    assert!(write_atomic(&root, "a/b/c.txt", "v2").is_ok());
    assert_eq!(fs::read_to_string(root.join("a/b/c.txt")).unwrap(), "v2");
}

#[test]
fn read_batch_reads_multiple_files_and_flags_missing() {
    let root = tmpdir("batch");
    fs::write(root.join("f1.txt"), "hello").unwrap();
    fs::write(root.join("f2.txt"), "world").unwrap();

    let rels = vec![
        "f1.txt".to_string(),
        "f2.txt".to_string(),
        "missing.txt".to_string(),
        "../escaped.txt".to_string(),
    ];
    let mut out = HashMap::new();
    for rel in rels {
        let content = resolve_inside(&root, &rel)
            .and_then(|abs| fs::read(abs).ok())
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
        out.insert(rel, content);
    }
    assert_eq!(out.get("f1.txt").unwrap().as_deref(), Some("hello"));
    assert_eq!(out.get("f2.txt").unwrap().as_deref(), Some("world"));
    assert_eq!(*out.get("missing.txt").unwrap(), None);
    assert_eq!(*out.get("../escaped.txt").unwrap(), None);
}

// -- tombstone ledger: corrupt input must not wedge sync --

#[test]
fn tombstone_survives_corrupt_ledger() {
    let root = tmpdir("tomb");
    fs::create_dir_all(root.join(".box")).unwrap();
    fs::write(root.join(".box/tombstones.json"), "{not json").unwrap();
    assert!(append_tombstone(&root, "edge1").is_ok());
    let raw = fs::read_to_string(root.join(".box/tombstones.json")).unwrap();
    let records: Vec<TombstoneRecord> = serde_json::from_str(&raw).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].edge_id, "edge1");
    assert!(records[0].at > 0);
    // dedupe
    assert!(append_tombstone(&root, "edge1").is_ok());
    assert!(append_tombstone(&root, "edge2").is_ok());
    let records: Vec<TombstoneRecord> =
        serde_json::from_str(&fs::read_to_string(root.join(".box/tombstones.json")).unwrap())
            .unwrap();
    let ids: Vec<&str> = records.iter().map(|r| r.edge_id.as_str()).collect();
    assert_eq!(ids, ["edge1", "edge2"]);
}

#[test]
fn tombstone_prunes_expired_entries() {
    let root = tmpdir("tomb-expire");
    fs::create_dir_all(root.join(".box")).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let expired_at = now.saturating_sub(TOMBSTONE_TTL_MS + 10_000);
    let fresh_at = now.saturating_sub(60_000);

    let seed = serde_json::json!([
        { "edgeId": "expired1", "at": expired_at },
        { "edgeId": "fresh1", "at": fresh_at }
    ]);
    fs::write(root.join(".box/tombstones.json"), seed.to_string()).unwrap();

    assert!(append_tombstone(&root, "edge3").is_ok());
    let records: Vec<TombstoneRecord> =
        serde_json::from_str(&fs::read_to_string(root.join(".box/tombstones.json")).unwrap())
            .unwrap();
    let ids: Vec<&str> = records.iter().map(|r| r.edge_id.as_str()).collect();
    assert_eq!(ids, ["edge3", "fresh1"]);
}

#[test]
fn tombstone_migrates_legacy_string_array() {
    let root = tmpdir("tomb-migrate");
    fs::create_dir_all(root.join(".box")).unwrap();
    fs::write(
        root.join(".box/tombstones.json"),
        r#"["legacy1", "legacy2"]"#,
    )
    .unwrap();

    assert!(append_tombstone(&root, "edge3").is_ok());
    let records: Vec<TombstoneRecord> =
        serde_json::from_str(&fs::read_to_string(root.join(".box/tombstones.json")).unwrap())
            .unwrap();
    let ids: Vec<&str> = records.iter().map(|r| r.edge_id.as_str()).collect();
    assert_eq!(ids, ["edge3", "legacy1", "legacy2"]);
    for r in records {
        assert!(r.at > 0);
    }
}

// -- mime_for: deliberate map, unknowns -> octet-stream --

#[test]
fn tombstone_never_clobbers_ledger_on_unreadable_read() {
    // A read failure that is neither "missing" nor "undecodable" (share lock,
    // permissions) must surface as an error, not as an empty ledger that the
    // following write would persist over every recorded tombstone. A
    // directory squatting on the ledger path forces a non-NotFound read error.
    let root = tmpdir("tomb-unreadable");
    fs::create_dir_all(root.join(".box/tombstones.json")).unwrap();
    assert!(append_tombstone(&root, "edge1").is_err());
    assert!(root.join(".box/tombstones.json").is_dir());
}

#[test]
fn debounce_flushes_during_a_sustained_stream() {
    // DATA-MODEL 5.2: the window extends while events keep arriving but is
    // capped. A stream that never goes quiet must still flush repeatedly;
    // the uncapped loop never emitted at all until the stream stopped.
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    let (tx, rx) = channel::<()>();
    let emits = Arc::new(AtomicUsize::new(0));
    let emits2 = Arc::clone(&emits);
    let worker = std::thread::spawn(move || {
        debounce_events(
            &rx,
            Duration::from_millis(60),
            Duration::from_millis(200),
            || {
                emits2.fetch_add(1, Ordering::SeqCst);
            },
        );
    });
    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(900) {
        tx.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(10)); // always < quiet window
    }
    let during = emits.load(Ordering::SeqCst);
    drop(tx);
    worker.join().unwrap();
    assert!(
        during >= 3,
        "expected capped flushes mid-stream, got {during}"
    );
}

#[test]
fn debounce_coalesces_a_short_burst_into_one_emit() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    let (tx, rx) = channel::<()>();
    let emits = Arc::new(AtomicUsize::new(0));
    let emits2 = Arc::clone(&emits);
    let worker = std::thread::spawn(move || {
        debounce_events(
            &rx,
            Duration::from_millis(80),
            Duration::from_secs(2),
            || {
                emits2.fetch_add(1, Ordering::SeqCst);
            },
        );
    });
    for _ in 0..20 {
        tx.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(5));
    }
    std::thread::sleep(Duration::from_millis(300)); // quiet -> flush
    drop(tx);
    worker.join().unwrap();
    assert_eq!(emits.load(Ordering::SeqCst), 1);
}

#[test]
fn mime_map_covers_media_and_defaults() {
    assert_eq!(mime_for("x.PNG"), "image/png"); // case-insensitive
    assert_eq!(mime_for("a/b/c.mp4"), "video/mp4");
    assert_eq!(mime_for("x.md"), "text/markdown; charset=utf-8");
    assert_eq!(mime_for("x.mystery"), "application/octet-stream");
    assert_eq!(mime_for("noext"), "application/octet-stream");
}

// -- box:// Range attacks --

#[test]
fn range_attacks() {
    let dir = tmpdir("range");
    let f = dir.join("f.bin");
    fs::write(&f, b"0123456789").unwrap();

    // normal range
    let r = mime_and_body(&f, Some("bytes=2-5")).unwrap();
    assert_eq!(r.status(), 206);
    assert_eq!(r.body().as_ref(), b"2345");
    assert_eq!(r.headers().get("Content-Range").unwrap(), "bytes 2-5/10");

    // open-ended + suffix forms
    let r = mime_and_body(&f, Some("bytes=8-")).unwrap();
    assert_eq!(r.body().as_ref(), b"89");
    let r = mime_and_body(&f, Some("bytes=-3")).unwrap();
    assert_eq!(r.body().as_ref(), b"789");

    // out-of-bounds clamps to EOF (not a crash)
    let r = mime_and_body(&f, Some("bytes=8-99999")).unwrap();
    assert_eq!(r.status(), 206);
    assert_eq!(r.body().as_ref(), b"89");

    // unsatisfiable -> 416, advertises real length
    let r = mime_and_body(&f, Some("bytes=50-99")).unwrap();
    assert_eq!(r.status(), 416);
    assert_eq!(r.headers().get("Content-Range").unwrap(), "bytes */10");

    // malformed -> Err -> handler maps to 404
    assert!(mime_and_body(&f, Some("garbage")).is_err());
    assert!(mime_and_body(&f, Some("bytes=")).is_err());

    // multi-range: serve first range (documented single-range behavior),
    // never panic, never emit a fake multipart body.
    let r = mime_and_body(&f, Some("bytes=0-1,5-7")).unwrap();
    assert_eq!(r.status(), 206);
    assert_eq!(r.body().as_ref(), b"01");

    // empty file + range -> clean 416
    let empty = dir.join("empty.bin");
    fs::write(&empty, b"").unwrap();
    let r = mime_and_body(&empty, Some("bytes=0-1")).unwrap();
    assert_eq!(r.status(), 416);

    // missing file -> Err
    assert!(mime_and_body(&dir.join("nope.bin"), None).is_err());

    // no range -> full body
    let r = mime_and_body(&f, None).unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.body().len(), 10);
}

#[test]
fn box_protocol_uri_decoding_and_boundary_attacks() {
    let root = tmpdir("protocol");
    let test_file = root.join("my image (1)#2+c.png");
    fs::write(&test_file, b"image-bytes").unwrap();

    // 1. Valid encoded path with special characters (spaces, parens, hash, plus)
    let raw_path = "/f/my%20image%20(1)%232%2Bc.png?v=1729684800";
    let path = raw_path.split('?').next().unwrap_or(raw_path);
    let rel_enc = path
        .strip_prefix("/f/")
        .unwrap_or(path.trim_start_matches('/'));
    let rel = percent_encoding::percent_decode_str(rel_enc)
        .decode_utf8_lossy()
        .to_string();
    assert_eq!(rel, "my image (1)#2+c.png");
    let abs = resolve_inside(&root, &rel);
    assert_eq!(abs, Some(test_file));

    // 2. Traversal attack with percent encoding
    let attack_path = "/f/%2E%2E%2Fsecret.txt";
    let path2 = attack_path.split('?').next().unwrap_or(attack_path);
    let rel_enc2 = path2
        .strip_prefix("/f/")
        .unwrap_or(path2.trim_start_matches('/'));
    let rel2 = percent_encoding::percent_decode_str(rel_enc2)
        .decode_utf8_lossy()
        .to_string();
    assert_eq!(rel2, "../secret.txt");
    assert_eq!(resolve_inside(&root, &rel2), None);

    // 3. Null byte injection
    let null_attack = "/f/image.png%00.exe";
    let path3 = null_attack.split('?').next().unwrap_or(null_attack);
    let rel_enc3 = path3
        .strip_prefix("/f/")
        .unwrap_or(path3.trim_start_matches('/'));
    let rel3 = percent_encoding::percent_decode_str(rel_enc3)
        .decode_utf8_lossy()
        .to_string();
    assert_eq!(resolve_inside(&root, &rel3), None);
}

// -- scan: skip rules + nested + mtime sanity --

#[test]
fn scan_skips_internal_dirs() {
    let root = tmpdir("scan");
    fs::create_dir_all(root.join(".box/tmp")).unwrap();
    fs::write(root.join(".box/tmp/leftover.tmp"), "x").unwrap();
    fs::write(root.join(".box/tombstones.json"), "[]").unwrap();
    fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    fs::write(root.join("node_modules/pkg/x.js"), "x").unwrap();
    fs::create_dir_all(root.join(".git/objects")).unwrap();
    fs::write(root.join(".git/objects/blob"), "x").unwrap();
    fs::create_dir_all(root.join("real/dir")).unwrap();
    fs::write(root.join("real/dir/f.txt"), "x").unwrap();
    fs::write(root.join("top.txt"), "x").unwrap();
    let mut out = Vec::new();
    scan_dir(&root, "", &mut out);
    let paths: Vec<&str> = out.iter().map(|f| f.path.as_str()).collect();
    assert!(paths.contains(&"real/dir/f.txt"));
    assert!(paths.contains(&"top.txt"));
    assert!(paths.contains(&".box/tombstones.json")); // visible (recorded decision)
    assert!(!paths.iter().any(|p| p.contains("node_modules")));
    assert!(!paths.iter().any(|p| p.contains(".git")));
    assert!(!paths.iter().any(|p| p.contains(".box/tmp")));
    assert!(out.iter().all(|f| f.mtime > 0));
}

// -- fs_read utf8 fidelity: binary lossy-decodes, not null --

#[test]
fn lossy_utf8_matches_node() {
    // invalid utf8 must produce U+FFFD, never None (Node parity)
    let bytes = vec![0x68, 0x69, 0xFF, 0xFE, 0x21];
    let s = String::from_utf8_lossy(&bytes);
    assert!(s.contains('\u{FFFD}'));
    assert!(s.ends_with('!'));
}

// -- TS/Rust policy parity: is_path_rel must match isPathRel exactly.
// A divergence here is a security hole visible only on one platform.
// The golden table below is generated FROM paths.ts semantics; keep in
// sync if the TS contract changes.

#[test]
fn path_rel_parity_golden_table() {
    let cases: &[(&str, bool)] = &[
        ("a.txt", true),
        ("dir/a.txt", true),
        (".hidden", true), // dotfile segment IS legal in the TS contract
        (".", false),
        ("..", false),
        ("a/.b/c", true),   // segment starting with dot is fine
        ("a/..b", true),    // "..b" is not ".."
        ("a/b..", false),   // ends with dot
        ("a/b ", false),    // ends with space
        ("a/b c", true),    // space inside segment is fine
        ("AUX", true),      // Windows reserved names NOT rejected (Node parity)
        ("a\u{85}b", true), // NEL is >= space: passes (TS checks <0x20)
        ("a\u{7f}b", true), // DEL passes too: contract is <0x20 only
        ("a\u{2028}b", true),
    ];
    for (p, want) in cases {
        assert_eq!(is_path_rel(p), *want, "parity: {p:?}");
    }
}

// -- import / create_new: the drop + context-menu surface --

#[test]
fn sanitize_filename_cleans_os_garbage() {
    assert_eq!(sanitize_filename("photo.png"), "photo.png");
    assert_eq!(sanitize_filename("a:b|c?d*.png"), "a-b-c-d-.png");
    assert_eq!(sanitize_filename(".."), "file");
    assert_eq!(sanitize_filename("."), "file");
    assert_eq!(sanitize_filename(""), "file");
    assert_eq!(sanitize_filename("name."), "name");
    assert_eq!(sanitize_filename("name.  "), "name");
    assert_eq!(sanitize_filename("dir/x.png"), "dir-x.png");
    assert_eq!(sanitize_filename("x\u{0}y.png"), "x-y.png");
    assert!(sanitize_filename(&"a".repeat(500)).len() <= 180);
}

#[test]
fn sanitize_filename_renames_windows_devices() {
    // Legal on macOS/Linux, unopenable on Windows - minted names must be
    // least-common-denominator safe since workspaces travel cross-OS.
    assert_eq!(sanitize_filename("con"), "file-con");
    assert_eq!(sanitize_filename("nul.md"), "file-nul.md");
    assert_eq!(sanitize_filename("COM1.txt"), "file-COM1.txt");
    assert_eq!(sanitize_filename("lpt9.png"), "file-lpt9.png");
    assert_eq!(sanitize_filename("clock$"), "file-clock$");
    // Prefixes/suffixes break device-name status - pass through.
    assert_eq!(sanitize_filename("concert.md"), "concert.md");
    assert_eq!(sanitize_filename("a.com1"), "a.com1");
    assert_eq!(sanitize_filename("com10.txt"), "com10.txt");
}

#[test]
fn unique_dest_numbers_collisions() {
    let d = tmpdir("uniq");
    fs::write(d.join("a.txt"), b"1").unwrap();
    fs::write(d.join("a-1.txt"), b"1").unwrap();
    assert_eq!(unique_dest(&d, "a.txt"), d.join("a-2.txt"));
    assert_eq!(unique_dest(&d, "b.txt"), d.join("b.txt"));
    // no extension -> plain -N suffix, no stray dot
    assert_eq!(unique_dest(&d, "README"), d.join("README"));
    fs::write(d.join("README"), b"1").unwrap();
    assert_eq!(unique_dest(&d, "README"), d.join("README-1"));
}

#[test]
fn import_one_copies_outside_and_dedupes_inside() {
    let ws = tmpdir("imp-ws");
    let outside = tmpdir("imp-out");
    // NTFS can't host ':'/'?' names at all (os error 87 here proves it), so
    // sanitize_filename is exercised in its own test; import still must
    // produce a PathRel from any creatable name.
    fs::write(outside.join("my photo.png"), b"PNG").unwrap();
    let rel = import_one(&ws, &outside.join("my photo.png")).unwrap();
    assert!(is_path_rel(&rel), "imported rel must be a PathRel: {rel}");
    assert_eq!(fs::read(ws.join(&rel)).unwrap(), b"PNG");
    // same basename from a different source dir -> -1 suffix, no clobber
    let outside2 = tmpdir("imp-out2");
    fs::write(outside2.join("my photo.png"), b"PNG2").unwrap();
    let rel2 = import_one(&ws, &outside2.join("my photo.png")).unwrap();
    assert_ne!(rel, rel2);
    assert_eq!(fs::read(ws.join(&rel2)).unwrap(), b"PNG2");
    // a file already inside the workspace: no copy, returns same rel
    fs::write(ws.join("inside.md"), b"hi").unwrap();
    let rel3 = import_one(&ws, &ws.join("inside.md")).unwrap();
    assert_eq!(rel3, "inside.md");
    // missing and directories are clean errors, never panics
    assert!(import_one(&ws, &outside.join("nope.bin")).is_err());
    assert!(import_one(&ws, &outside).is_err());
}

#[test]
fn create_new_never_overwrites() {
    let ws = tmpdir("new");
    let p1 = create_new(&ws, "", "untitled", "md", b"a").unwrap();
    assert_eq!(p1, "untitled.md");
    let p2 = create_new(&ws, "", "untitled", "md", b"b").unwrap();
    assert_eq!(p2, "untitled-1.md");
    // first file's bytes are untouched
    assert_eq!(fs::read(ws.join("untitled.md")).unwrap(), b"a");
    // dir creation + traversal rejection
    let p3 = create_new(&ws, "notes/daily", "doc", "txt", b"c").unwrap();
    assert_eq!(p3, "notes/daily/doc.txt");
    assert!(create_new(&ws, "../escape", "x", "txt", b"").is_err());
    assert!(create_new(&ws, "a/bad:dir", "x", "txt", b"").is_err());
    // hostile stem/ext get sanitized into something valid
    let p4 = create_new(&ws, "", "..|x", ".m?d", b"z").unwrap();
    assert!(is_path_rel(&p4), "created path must be PathRel: {p4}");
}

#[test]
fn fs_copy_copies_never_overwrites_and_names_safely() {
    let ws = tmpdir("copy");
    fs::write(ws.join("tone.wav"), b"AUD").unwrap();
    // happy path: <stem>-copy.<ext>, bytes identical
    let r = fs_copy_inner(&ws, "tone.wav").unwrap();
    assert_eq!(r, "tone-copy.wav");
    assert_eq!(fs::read(ws.join(&r)).unwrap(), b"AUD");
    // collision chain: -copy, -copy-1, -copy-2 - source never clobbered
    let r2 = fs_copy_inner(&ws, "tone.wav").unwrap();
    assert_eq!(r2, "tone-copy-1.wav");
    let r3 = fs_copy_inner(&ws, "tone.wav").unwrap();
    assert_eq!(r3, "tone-copy-2.wav");
    assert_eq!(fs::read(ws.join("tone.wav")).unwrap(), b"AUD");
    // nested parent preserved
    fs::create_dir_all(ws.join("refs")).unwrap();
    fs::write(ws.join("refs/f.md"), b"md").unwrap();
    let r4 = fs_copy_inner(&ws, "refs/f.md").unwrap();
    assert_eq!(r4, "refs/f-copy.md");
    // dotfile + extensionless: no synthetic extension, no trailing dot
    fs::write(ws.join(".env"), b"K=V").unwrap();
    let r5 = fs_copy_inner(&ws, ".env").unwrap();
    assert_eq!(r5, ".env-copy");
    fs::write(ws.join("README"), b"r").unwrap();
    let r6 = fs_copy_inner(&ws, "README").unwrap();
    assert_eq!(r6, "README-copy");
    // multi-dot keeps the Node-style last extension
    fs::write(ws.join("a.tar.gz"), b"t").unwrap();
    let r7 = fs_copy_inner(&ws, "a.tar.gz").unwrap();
    assert_eq!(r7, "a.tar-copy.gz");
    // failure shapes: escapes, missing, directory - all clean errors
    assert!(fs_copy_inner(&ws, "../evil").is_err());
    assert!(fs_copy_inner(&ws, "a\\b").is_err());
    assert!(fs_copy_inner(&ws, "nope.bin").is_err());
    assert!(fs_copy_inner(&ws, "refs").is_err());
}

#[test]
fn file_icon_caches_png_and_rejects_bad_paths() {
    let ws = tmpdir("icon");
    fs::write(ws.join("doc.md"), b"md").unwrap();
    // bad paths fail before touching the OS
    assert!(file_icon_inner(&ws, "../evil").is_err());
    assert!(file_icon_inner(&ws, "nope.xyz").is_err());
    // a real file resolves to a cached PNG under .box/icons (or a clean
    // error on hosts without shell association - CI-safe either way)
    if let Ok(rel) = file_icon_inner(&ws, "doc.md") {
        assert!(rel.starts_with(".box/icons/icon-") && rel.ends_with(".png"));
        let bytes = fs::read(ws.join(&rel)).unwrap();
        assert_eq!(&bytes[..4], b"\x89PNG");
        // second call hits the cache and returns the same path
        assert_eq!(file_icon_inner(&ws, "doc.md").unwrap(), rel);
    }
}

#[test]
fn file_thumb_caches_by_mtime_and_rejects_bad_paths() {
    let ws = tmpdir("thumb");
    fs::write(ws.join("pic.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    assert!(file_thumb_inner(&ws, "../evil").is_err());
    assert!(file_thumb_inner(&ws, "nope.bin").is_err());
    // a real file resolves to .box/thumbs/<key>.png on Windows (or errs
    // cleanly on hosts where the shell can't thumbnail it)
    if let Ok(rel) = file_thumb_inner(&ws, "pic.png") {
        assert!(rel.starts_with(".box/thumbs/thumb-") && rel.ends_with(".png"));
        let b = fs::read(ws.join(&rel)).unwrap();
        assert_eq!(&b[..4], b"\x89PNG");
        // same mtime -> same cached path (no re-encode)
        assert_eq!(file_thumb_inner(&ws, "pic.png").unwrap(), rel);
        // touch a new mtime -> a different cache key
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(ws.join("pic.png"), b"\x89PNG\r\n\x1a\nmore").unwrap();
        let r2 = file_thumb_inner(&ws, "pic.png");
        assert!(r2.is_err() || r2.unwrap() != rel);
    }
}

#[test]
fn decide_post_allowlist_is_loopback_only() {
    // ADR-0010: the zero-cloud rule lives here - the command must refuse
    // anything that is not a loopback http URL, including smuggled forms.
    assert!(is_loopback_url("http://127.0.0.1:8770/v1/systemone"));
    assert!(is_loopback_url("http://localhost:47311/x"));
    assert!(is_loopback_url("http://[::1]:11434/api"));
    assert!(!is_loopback_url("https://127.0.0.1:8770/x"));
    assert!(!is_loopback_url("http://example.com"));
    assert!(!is_loopback_url("http://127.0.0.1.evil.com/x"));
    assert!(!is_loopback_url("http://127.0.0.1@evil.com/x"));
    assert!(!is_loopback_url("ftp://127.0.0.1/x"));
    assert!(!is_loopback_url("http://localhost.evil/x"));
    assert!(!is_loopback_url(""));
}

#[test]
fn decide_post_allowlist_rejects_userinfo_and_port_smuggling() {
    // `user:pass@host` makes "127.0.0.1:8770" the *userinfo*; the real
    // host is whatever follows '@'. A prefix-only check passes all of these
    // while ureq connects to the external host (zero-cloud breach).
    assert!(!is_loopback_url("http://127.0.0.1:8770@evil.com/x"));
    assert!(!is_loopback_url("http://localhost:80@evil.com"));
    assert!(!is_loopback_url("http://[::1]:11434@evil.com/api"));
    // '@' after the path is legal path text and stays on loopback.
    assert!(is_loopback_url("http://127.0.0.1:8770/x@evil.com"));
    // malformed / non-numeric / oversized ports and backslash authority tricks
    assert!(!is_loopback_url("http://localhost:evil.com/x"));
    assert!(!is_loopback_url("http://127.0.0.1:/x"));
    assert!(!is_loopback_url("http://127.0.0.1:999999/x"));
    assert!(!is_loopback_url("http://127.0.0.1:80\\@evil.com/"));
    assert!(!is_loopback_url("http://127.0.0.1\\@evil.com/"));
    // bare hosts, query and fragment terminators, case-insensitive localhost
    assert!(is_loopback_url("http://127.0.0.1"));
    assert!(is_loopback_url("http://127.0.0.1?x=1"));
    assert!(is_loopback_url("http://LOCALHOST:8770/x"));
    assert!(!is_loopback_url("http://127.0.0.2:8770/x"));
}

#[test]
fn create_new_handles_empty_ext_without_trailing_dot() {
    let ws = tmpdir("new-ext");
    let p = create_new(&ws, "", "dotless", "", b"x").unwrap();
    assert_eq!(p, "dotless");
    let p2 = create_new(&ws, "", "dotless", "", b"y").unwrap();
    assert_eq!(p2, "dotless-1");
}

#[test]
fn open_with_app_must_be_absolute_existing_file() {
    // The app path is user-picked and lives outside the workspace - the
    // contract is absolute + existing file, never workspace containment.
    assert!(!valid_open_with_app(""));
    assert!(!valid_open_with_app("relative/app.exe"));
    assert!(!valid_open_with_app(
        "C:/definitely/not/a-real-app-12345.exe"
    ));
    assert!(!valid_open_with_app("..\\evil.exe"));
    // A real absolute file passes (use the temp dir we control).
    let ws = tmpdir("openwith");
    let app = ws.join("fake-editor.exe");
    fs::write(&app, b"MZ").unwrap();
    let app_str = app.to_string_lossy().replace('\\', "/");
    assert!(valid_open_with_app(&app_str));
    // A directory is not an app.
    assert!(!valid_open_with_app(
        &ws.to_string_lossy().replace('\\', "/")
    ));
}
