"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  run,
  captureGit,
  assertReleaseBranch,
  assertCleanWorkingTree,
  updateRemoteMain,
  getLatestVersionTag,
  getCommitMessagesSince,
  classifyCommit,
  determineReleaseType,
  resolveReleaseType,
  updateReadmeVersionBadge,
  prepareRelease,
} = require("../scripts/release");

test("classifyCommit maps publishable Conventional Commit types", () => {
  assert.equal(classifyCommit("feat: add process grouping"), "minor");
  assert.equal(classifyCommit("fix(status): correct rounding"), "patch");
  assert.equal(classifyCommit("perf: reduce process scans"), "patch");
  assert.equal(classifyCommit("refactor(core): isolate parsing"), "patch");
  assert.equal(classifyCommit("chore: update dependencies"), "patch");
});

test("classifyCommit detects breaking changes", () => {
  assert.equal(classifyCommit("feat!: remove legacy format"), "major");
  assert.equal(classifyCommit("feat(api): change output\n\nBREAKING CHANGE: output is now structured"), "major");
});

test("classifyCommit ignores non-release types and skip markers", () => {
  for (const type of ["docs", "test", "ci", "style", "infra"]) {
    assert.equal(classifyCommit(`${type}: repository maintenance`), null);
  }
  assert.equal(classifyCommit(""), null);
  assert.equal(classifyCommit("not a conventional commit"), null);
  assert.equal(classifyCommit("fix: internal-only adjustment [skip release]"), null);
});

test("determineReleaseType selects the highest required impact", () => {
  assert.equal(determineReleaseType(["fix: one", "feat: two", "docs: three"]), "minor");
  assert.equal(determineReleaseType(["fix: one", "feat!: two"]), "major");
  assert.equal(determineReleaseType(["docs: one", "infra: two"]), null);
});

test("resolveReleaseType accepts automatic or higher explicit increments", () => {
  const messages = ["feat: add display mode"];
  assert.equal(resolveReleaseType(messages, "auto"), "minor");
  assert.equal(resolveReleaseType(messages, "major"), "major");
  assert.equal(resolveReleaseType(["docs: only documentation"], "auto"), null);
  assert.throws(() => resolveReleaseType(messages, "invalid"), /must be auto, patch, minor, or major/);
  assert.throws(() => resolveReleaseType(messages, "patch"), /require at least a minor/);
});

test("run and captureGit execute commands with captured output", () => {
  assert.equal(run(process.execPath, ["-e", "process.stdout.write('ok')"], { capture: true }), "ok");
  assert.equal(captureGit(["rev-parse", "--is-inside-work-tree"]), "true");
});

test("release preconditions validate branch and working tree", () => {
  assert.doesNotThrow(() => assertReleaseBranch(() => "develop"));
  assert.throws(() => assertReleaseBranch(() => "feature/example"), /current branch: feature\/example/);
  assert.throws(() => assertReleaseBranch(() => ""), /detached HEAD/);

  assert.doesNotThrow(() => assertCleanWorkingTree(() => ""));
  assert.throws(() => assertCleanWorkingTree(() => " M README.md"), /working tree is not clean/);
});

test("updateRemoteMain fetches and rejects diverged branches", () => {
  const calls = [];
  updateRemoteMain((command, args) => calls.push([command, args]), () => ({ status: 0 }));
  assert.deepEqual(calls, [["git", ["fetch", "origin", "main", "--quiet"]]]);

  assert.throws(
    () => updateRemoteMain(() => {}, () => ({ status: 1 })),
    /develop does not contain the latest main/
  );
});

test("version tag and commit readers handle repositories with and without tags", () => {
  assert.equal(getLatestVersionTag(() => "v1.0.3"), "v1.0.3");
  assert.equal(getLatestVersionTag(() => { throw new Error("no tag"); }), null);

  let requestedArgs;
  const messages = getCommitMessagesSince("v1.0.3", (args) => {
    requestedArgs = args;
    return "fix: one\x1e\n\nfeat: two\x1e";
  });
  assert.deepEqual(requestedArgs, ["log", "v1.0.3..HEAD", "--format=%B%x1e"]);
  assert.deepEqual(messages, ["fix: one", "feat: two"]);
  assert.deepEqual(getCommitMessagesSince(null, () => ""), []);
});

test("updateReadmeVersionBadge writes a cache-safe badge for the prepared version", () => {
  const source = "[![Version](https://vsmarketplacebadges.dev/version-short/SergioSuarezGil.omnimem.svg)](https://marketplace.visualstudio.com/items?itemName=SergioSuarezGil.omnimem)";
  let written;

  updateReadmeVersionBadge("1.0.5", () => source, (_path, contents, encoding) => {
    assert.equal(encoding, "utf8");
    written = contents;
  }, "README.md");

  assert.match(written, /VS%20Marketplace-v1\.0\.5-007ACC/);
  assert.throws(
    () => updateReadmeVersionBadge("1.0.5", () => "no badge", () => {}, "README.md"),
    /expected Marketplace version badge/
  );
});

test("prepareRelease exits cleanly when there are no publishable commits", () => {
  const logs = [];
  let executed = false;
  prepareRelease("auto", {
    assertBranch() {},
    assertClean() {},
    updateMain() {},
    readLatestTag: () => "v1.0.3",
    readMessages: () => ["docs: update readme"],
    resolveType: () => null,
    execute: () => { executed = true; },
    logger: { log: (line) => logs.push(line) },
  });
  assert.equal(executed, false);
  assert.match(logs[0], /No publishable changes found since v1\.0\.3/);
});

test("prepareRelease validates, packages, versions, and documents a release", () => {
  const lifecycle = [];
  const commands = [];
  const logs = [];
  const badges = [];
  prepareRelease("minor", {
    assertBranch: () => lifecycle.push("branch"),
    assertClean: () => lifecycle.push("clean"),
    updateMain: () => lifecycle.push("main"),
    readLatestTag: () => "v1.0.3",
    readMessages: (tag) => {
      assert.equal(tag, "v1.0.3");
      return ["feat: add dashboard"];
    },
    resolveType: (messages, requested) => {
      assert.equal(messages.length, 1);
      assert.equal(requested, "minor");
      return "minor";
    },
    execute: (command, args) => commands.push([command, args]),
    platform: "win32",
    readVersion: () => "1.1.0",
    updateBadge: (version) => badges.push(version),
    logger: { log: (line) => logs.push(line) },
  });

  assert.deepEqual(lifecycle, ["branch", "clean", "main"]);
  assert.deepEqual(commands, [
    ["npm.cmd", ["test"]],
    ["npm.cmd", ["run", "package"]],
    ["npm.cmd", ["version", "minor", "--no-git-tag-version"]],
    ["npm.cmd", ["run", "changelog:generate"]],
  ]);
  assert.deepEqual(badges, ["1.1.0"]);
  assert.ok(logs.some((line) => /Release v1\.1\.0 is prepared locally/.test(line)));
});
