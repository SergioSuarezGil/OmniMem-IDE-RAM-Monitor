#!/usr/bin/env node

"use strict";

const { execFileSync, spawnSync } = require("node:child_process");

const RELEASE_RANK = Object.freeze({ patch: 1, minor: 2, major: 3 });
const TYPE_IMPACT = Object.freeze({
  feat: "minor",
  fix: "patch",
  perf: "patch",
  refactor: "patch",
  chore: "patch",
});

function classifyCommit(message) {
  const normalized = message.trim();

  if (!normalized || /\[skip release\]/i.test(normalized)) {
    return null;
  }

  const firstLine = normalized.split(/\r?\n/, 1)[0];
  const match = firstLine.match(/^([a-z][a-z0-9-]*)(?:\([^\r\n)]+\))?(!)?:\s+/i);
  const hasBreakingChange = /^BREAKING[ -]CHANGE:\s+/im.test(normalized);

  if (hasBreakingChange || match?.[2] === "!") {
    return "major";
  }

  return match ? TYPE_IMPACT[match[1].toLowerCase()] ?? null : null;
}

function determineReleaseType(messages) {
  let selected = null;

  for (const message of messages) {
    const impact = classifyCommit(message);
    if (impact && (!selected || RELEASE_RANK[impact] > RELEASE_RANK[selected])) {
      selected = impact;
    }
  }

  return selected;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function captureGit(args) {
  return run("git", args, { capture: true }).trim();
}

function assertReleaseBranch() {
  const branch = captureGit(["branch", "--show-current"]);
  if (branch !== "develop") {
    throw new Error(`Releases must be prepared from develop (current branch: ${branch || "detached HEAD"}).`);
  }
}

function assertCleanWorkingTree() {
  if (captureGit(["status", "--porcelain"])) {
    throw new Error("The working tree is not clean. Commit or stash your changes before preparing a release.");
  }
}

function updateRemoteMain() {
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const result = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("develop does not contain the latest main. Synchronize the branches before preparing a release.");
  }
}

function getLatestVersionTag() {
  try {
    return captureGit(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
  } catch {
    return null;
  }
}

function getCommitMessagesSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const output = captureGit(["log", range, "--format=%B%x1e"]);
  return output ? output.split("\x1e").map((message) => message.trim()).filter(Boolean) : [];
}

function resolveReleaseType(messages, requestedType) {
  const detectedType = determineReleaseType(messages);

  if (!detectedType) {
    return null;
  }

  if (!requestedType || requestedType === "auto") {
    return detectedType;
  }

  if (!(requestedType in RELEASE_RANK)) {
    throw new Error("Release type must be auto, patch, minor, or major.");
  }

  if (RELEASE_RANK[requestedType] < RELEASE_RANK[detectedType]) {
    throw new Error(`Requested ${requestedType}, but the commits require at least a ${detectedType} release.`);
  }

  return requestedType;
}

function prepareRelease(requestedType = "auto") {
  assertReleaseBranch();
  assertCleanWorkingTree();
  updateRemoteMain();

  const latestTag = getLatestVersionTag();
  const messages = getCommitMessagesSince(latestTag);
  const releaseType = resolveReleaseType(messages, requestedType);

  if (!releaseType) {
    console.log(`No publishable changes found since ${latestTag ?? "the beginning of the repository"}.`);
    return;
  }

  console.log(`Preparing a ${releaseType} release from ${messages.length} commit(s)...`);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCommand, ["test"]);
  run(npmCommand, ["run", "package"]);
  run(npmCommand, ["version", releaseType, "--no-git-tag-version"]);
  run(npmCommand, ["run", "changelog:generate"]);

  const version = require(`${process.cwd()}/package.json`).version;
  console.log(`\nRelease v${version} is prepared locally.`);
  console.log("Review package.json, package-lock.json, and CHANGELOG.md before committing.");
  console.log("No commit, tag, push, merge, or publication was performed.");
}

if (require.main === module) {
  try {
    prepareRelease(process.argv[2] ?? "auto");
  } catch (error) {
    console.error(`Release preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  classifyCommit,
  determineReleaseType,
  resolveReleaseType,
};
