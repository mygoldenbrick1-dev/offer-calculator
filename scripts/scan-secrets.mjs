#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

const mode = process.argv.includes("--all") ? "all" : "staged";

const blockedFileMatchers = [
  /^\.env$/i,
  /^\.env\..+/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.crt$/i,
  /^id_rsa$/i,
  /^id_dsa$/i,
  /^id_ecdsa$/i,
  /^id_ed25519$/i
];

const safePathAllowList = new Set([
  ".env.example"
]);

const textExtensions = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".txt", ".yaml", ".yml", ".html", ".css", ".scss", ".env", ".gitignore", ".npmrc", ""
]);

const secretPatterns = [
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { name: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Private key block", regex: /-----BEGIN (RSA|DSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----/g },
  { name: "Generic API key assignment", regex: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\n]{8,}["']/gi },
  { name: "Bearer token", regex: /Bearer\s+[A-Za-z0-9\-_.=]{20,}/g }
];

function getFiles() {
  const cmd = mode === "all"
    ? "git ls-files"
    : "git diff --cached --name-only --diff-filter=ACMRT";

  const output = execSync(cmd, { encoding: "utf8" }).trim();
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isLikelyText(path) {
  const ext = extname(path).toLowerCase();
  if (textExtensions.has(ext)) {
    return true;
  }

  try {
    const chunk = readFileSync(path);
    for (let i = 0; i < Math.min(chunk.length, 1024); i += 1) {
      if (chunk[i] === 0) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function blockedByName(path) {
  const normalized = path.replace(/\\/g, "/").split("/").pop() ?? path;

  if (safePathAllowList.has(path) || safePathAllowList.has(normalized)) {
    return false;
  }

  return blockedFileMatchers.some((matcher) => matcher.test(path) || matcher.test(normalized));
}

const files = getFiles();
const blockedFiles = [];
const hits = [];

for (const file of files) {
  if (!existsSync(file)) {
    continue;
  }

  if (blockedByName(file)) {
    blockedFiles.push(file);
    continue;
  }

  if (!isLikelyText(file)) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  for (const { name, regex } of secretPatterns) {
    const match = content.match(regex);
    if (match && match.length > 0) {
      hits.push({ file, name, sample: String(match[0]).slice(0, 80) });
    }
  }
}

if (blockedFiles.length === 0 && hits.length === 0) {
  process.exit(0);
}

console.error("\nSecret scan failed. Remove sensitive files/data before committing or pushing.\n");

if (blockedFiles.length > 0) {
  console.error("Blocked sensitive file names:");
  for (const file of blockedFiles) {
    console.error(`- ${file}`);
  }
  console.error("");
}

if (hits.length > 0) {
  console.error("Potential secret patterns detected:");
  for (const hit of hits) {
    console.error(`- ${hit.file}: ${hit.name} (${hit.sample})`);
  }
  console.error("");
}

console.error("If this is a false positive, move data to runtime env vars and keep only placeholders.");
process.exit(1);
