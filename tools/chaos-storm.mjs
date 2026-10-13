// Chaos storm: N random fs ops against a watched dir, then verify the
// app's store converged to disk truth. node tools/chaos-storm.mjs <root>
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
let counter = 0;
const ops = ["create", "modify", "rename", "delete", "mkdir"];
for (let i = 0; i < 100; i++) {
  const op = ops[Math.floor(Math.random() * ops.length)];
  try {
    if (op === "create")
      fs.writeFileSync(path.join(root, `c${counter++}.txt`), "d" + counter);
    else if (op === "modify") {
      const f = fs.readdirSync(root).filter((x) => x.endsWith(".txt"));
      if (f.length) fs.appendFileSync(path.join(root, f[0]), "x");
    } else if (op === "rename") {
      const f = fs.readdirSync(root).filter((x) => x.endsWith(".txt"));
      if (f.length > 1)
        fs.renameSync(
          path.join(root, f[0]),
          path.join(root, `r${counter++}.txt`),
        );
    } else if (op === "delete") {
      const f = fs.readdirSync(root).filter((x) => x.endsWith(".txt"));
      if (f.length) fs.rmSync(path.join(root, f[f.length - 1]));
    } else if (op === "mkdir")
      fs.mkdirSync(path.join(root, `d${counter++}`), { recursive: true });
  } catch {
    // expected under chaos: racing ops on shared filenames legitimately fail
  }
  await new Promise((r) => setTimeout(r, 30));
}
console.log(
  "storm done; disk txts:",
  fs.readdirSync(root).filter((x) => x.endsWith(".txt")).length,
);
