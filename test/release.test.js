"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyCommit,
  determineReleaseType,
  resolveReleaseType,
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
  assert.throws(() => resolveReleaseType(messages, "patch"), /require at least a minor/);
});
