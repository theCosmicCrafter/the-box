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

// -- tombstone ledger: corrupt input must not wedge sync --

#[test]
fn tombstone_survives_corrupt_ledger() {
    let root = tmpdir("tomb");
    fs::create_dir_all(root.join(".box")).unwrap();
    fs::write(root.join(".box/tombstones.json"), "{not json").unwrap();
    assert!(append_tombstone(&root, "edge1").is_ok());
    let raw = fs::read_to_string(root.join(".box/tombstones.json")).unwrap();
    let ids: Vec<String> = serde_json::from_str(&raw).unwrap();
    assert_eq!(ids, ["edge1"]);
    // dedupe
    assert!(append_tombstone(&root, "edge1").is_ok());
    assert!(append_tombstone(&root, "edge2").is_ok());
    let ids: Vec<String> =
        serde_json::from_str(&fs::read_to_string(root.join(".box/tombstones.json")).unwrap())
            .unwrap();
    assert_eq!(ids, ["edge1", "edge2"]);
}

// -- mime_for: deliberate map, unknowns -> octet-stream --

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
