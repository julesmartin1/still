import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = await mkdtemp(join(tmpdir(), "still-vault-"));
try {
  const binary = join(temp, "tests");
  let result = spawnSync(
    "swiftc",
    ["ios/App/App/VaultCore.swift", "tests/native/main.swift", "-o", binary],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exitCode = result.status || 1;
  else {
    result = spawnSync(binary, [], { stdio: "inherit" });
    process.exitCode = result.status || 0;
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
