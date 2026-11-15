/**
 * Release checks for the tarball npm would publish — zero network.
 *
 * Why this exists: until 0.1.4 `prepublishOnly` skipped the build whenever a
 * dist/ directory existed, and the dist/ on the build host was from May 2026
 * (it still held tools/hakem-review.js, a tool renamed in 0.1.3). A publish
 * from that directory would have shipped 0.1.3's code under the 0.1.4 version
 * number. Now `npm test` (and so `prepublishOnly`) always rebuilds from src/,
 * and this file refuses a dist/ that does not match src/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const pkg = JSON.parse(read("package.json"));

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("package.json, server.json and the changelog name one version", () => {
  const server = JSON.parse(read("server.json"));
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].version, pkg.version);
  assert.match(read("CHANGELOG.md"), new RegExp(`^## ${pkg.version.replace(/\./g, "\\.")}\\b`, "m"));
  // A changelog frozen into a published tarball must not call its own version unpublished.
  assert.doesNotMatch(read("CHANGELOG.md"), /not yet published/i);
});

test("dist/ is exactly the build of src/ — one .js per .ts, nothing left over", () => {
  const src = walk(join(ROOT, "src")).map((p) => relative(join(ROOT, "src"), p).replace(/\.ts$/, ""));
  const dist = walk(join(ROOT, "dist"))
    .filter((p) => p.endsWith(".js"))
    .map((p) => relative(join(ROOT, "dist"), p).replace(/\.js$/, ""));
  assert.deepEqual(dist.sort(), src.sort());
  // Built AFTER the sources were last edited.
  const newestSrc = Math.max(...walk(join(ROOT, "src")).map((p) => statSync(p).mtimeMs));
  const oldestDist = Math.min(...walk(join(ROOT, "dist")).filter((p) => p.endsWith(".js")).map((p) => statSync(p).mtimeMs));
  assert.ok(oldestDist >= newestSrc, "dist/ is older than src/: run npm run build");
  assert.equal(existsSync(join(ROOT, "dist", "tools", "hakem-review.js")), false);
});

test("the built entry point is executable and reports the package version", () => {
  assert.match(read("dist", "index.js"), /^#!\/usr\/bin\/env node/);
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", "const { VERSION } = await import('./dist/version.js'); process.stdout.write(VERSION);"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(out, pkg.version);
});

test("without an API key the server exits 1 with a useful message and calls nothing", () => {
  let err = null;
  try {
    execFileSync(process.execPath, ["dist/index.js"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, SCIENCE_AI_API_KEY: "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected a non-zero exit");
  assert.equal(err.status, 1);
  assert.match(String(err.stderr), /SCIENCE_AI_API_KEY is required/);
});

test("the tarball holds dist + docs only: no sources, tests, env files or tokens", () => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const files = JSON.parse(out)[0].files.map((f) => f.path).sort();
  for (const must of [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "server.json",
    "dist/index.js",
    "dist/http.js",
    "dist/version.js",
    "dist/format/http-errors.js",
    "dist/format/pre-check.js",
    "dist/format/journal-recommender.js",
    "dist/tools/pre-check.js",
    "dist/tools/journal-recommender.js",
  ]) {
    assert.ok(files.includes(must), `tarball lacks ${must}`);
  }
  for (const f of files) {
    assert.doesNotMatch(f, /^(src|test|node_modules)\//, f);
    assert.doesNotMatch(f, /\.env|\.npmrc|\.tgz$/, f);
  }
});

test("outward text (README, changelog, descriptions): no person's name, no money figure, no Journal Finder accuracy figure", () => {
  const texts = {
    "README.md": read("README.md"),
    "CHANGELOG.md": read("CHANGELOG.md"),
    "package.json description": pkg.description,
    "server.json description": JSON.parse(read("server.json")).description,
  };
  for (const [name, t] of Object.entries(texts)) {
    assert.doesNotMatch(t, /[$€£₺]\s?\d|\b(USD|EUR|TRY)\b/, `${name}: a money figure`);
    assert.doesNotMatch(t, /\b(revenue|ciro|MRR|ARR)\b/i, `${name}: revenue wording`);
    assert.doesNotMatch(t, /\bfounder|kurucu\b/i, `${name}: founder wording`);
    // The Journal Finder's measured hit rate is not published in this package.
    assert.doesNotMatch(t, /top[- ]?5|top[- ]?3 hit|hit rate|accurac/i, `${name}: an accuracy claim`);
  }
});
