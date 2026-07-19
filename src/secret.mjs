import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { INTERNAL_SECRET_PATH, STATE_DIR } from "./paths.mjs";

const command = process.argv[2] || "status";
if (!new Set(["ensure", "status"]).has(command)) {
  console.error("Usage: secret.mjs ensure|status");
  process.exit(2);
}

if (command === "ensure") {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
  if (!existsSync(INTERNAL_SECRET_PATH)) {
    const temporary = `${INTERNAL_SECRET_PATH}.tmp.${process.pid}`;
    writeFileSync(temporary, `${randomBytes(48).toString("base64url")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(temporary, 0o600);
    renameSync(temporary, INTERNAL_SECRET_PATH);
  }
}

const valid =
  existsSync(INTERNAL_SECRET_PATH) &&
  readFileSync(INTERNAL_SECRET_PATH, "utf8").trim().length >= 32;
if (valid) chmodSync(INTERNAL_SECRET_PATH, 0o600);
process.stdout.write(
  `${JSON.stringify({ present: valid, mode: valid ? statSync(INTERNAL_SECRET_PATH).mode & 0o777 : null })}\n`,
);
if (!valid) process.exitCode = 1;
