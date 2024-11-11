"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// main.ts
var core = __toESM(require("@actions/core"));
var github = __toESM(require("@actions/github"));
var semver = __toESM(require("semver"));
var exec = __toESM(require("@actions/exec"));
var fs = __toESM(require("fs/promises"));
var octokit = github.getOctokit(core.getInput("token"));
var simpleSemverRegex = /\d+\.\d+\.\d+(-.*)?/;
var internalBotEmail = "internal@elementor.com";
async function run() {
  const currentRef = github.context.ref.replace("refs/heads/", "");
  const commitInfo = await octokit.request(
    "GET /repos/{owner}/{repo}/commits/{sha}",
    {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      sha: github.context.sha
    }
  );
  if (commitInfo.data.commit.author.email === internalBotEmail) return;
  const diff = await octokit.request(
    "GET /repos/{owner}/{repo}/commits/{sha}",
    {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      sha: github.context.sha,
      headers: {
        accept: "application/vnd.github.diff"
      }
    }
  );
  if (!diff.data) return;
  const changedVersions = getVersions(diff.data);
  const oldest = getOldestVersionFromChanged(changedVersions);
  if (!oldest) return;
  const branches = await octokit.request(
    "GET /repos/{owner}/{repo}/branches",
    {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo
    }
  );
  const gitBranches = branches.data.filter((branch) => {
    const toSemver = semver.parse(branch.name + ".0");
    return toSemver && semver.gt(toSemver.version, oldest);
  });
  const branchesToPRTo = gitBranches.map((branch) => branch.name);
  branchesToPRTo.push("main");
  const changelog = await fs.readFile("changelog.txt");
  let readmeContent = void 0;
  if (github.context.repo.repo === "elementor") {
    readmeContent = await fs.readFile("readme.txt");
  }
  for (const branch of branchesToPRTo) {
    await createPRWithChangesOnChangelog(
      currentRef,
      branch,
      changelog,
      readmeContent
    );
  }
}
async function createPRWithChangesOnChangelog(sourceBranch, targetBranch, changelogContent, readmeContent) {
  const PRBranchName = `changelog-${sourceBranch}-to-${targetBranch}`;
  const PRMessage = `Internal: Changelog v${sourceBranch} to ${targetBranch} (automatic)`;
  await exec.exec(`git fetch --all`);
  await exec.exec(`git checkout ${targetBranch}`);
  await exec.exec(`git pull`);
  await exec.exec(`git config user.name "elementor internal"`);
  await exec.exec(`git config user.email ${internalBotEmail}`);
  await exec.exec(`git reset --hard origin/${targetBranch}`);
  if (readmeContent) {
    await fs.writeFile("readme.txt", readmeContent);
  }
  await fs.writeFile("changelog.txt", changelogContent);
  await exec.exec(`git checkout -b ${PRBranchName}`);
  await exec.exec(`git add changelog.txt readme.txt`);
  await exec.exec(`git commit -m "${PRMessage}"`);
  await exec.exec(`git push --set-upstream origin ${PRBranchName}`);
  await octokit.request("POST /repos/{owner}/{repo}/pulls", {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    title: PRMessage,
    head: PRBranchName,
    base: targetBranch
  });
}
function getOldestVersionFromChanged(changedVersions) {
  if (changedVersions.length === 0) return;
  let min = changedVersions[0];
  for (const version of changedVersions) {
    if (semver.lt(version, min)) {
      min = version;
    }
  }
  return min;
}
function getVersions(diff) {
  const parsedDiff = diff.split("\n");
  const changedVersions = [];
  let match;
  for (const line of parsedDiff) {
    if (!line.startsWith("+")) continue;
    if (line.startsWith("+#") || line.startsWith("+=")) {
      match = getVersionFromLine(line);
      if (match) changedVersions.push(match);
    }
  }
  return changedVersions;
}
function getVersionFromLine(line) {
  const match = simpleSemverRegex.exec(line);
  if (match && match.length > 0) return match[0];
  return void 0;
}

// index.ts
void run();
