import http from "node:http";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const defaultRepoPath = process.cwd();
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const maxBuffer = 32 * 1024 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function buildGitArgs(context, args) {
  if (context.isBare) {
    return ["--git-dir", context.gitDir, ...args];
  }
  return ["--git-dir", context.gitDir, "--work-tree", context.repoPath, ...args];
}

async function runGit(context, args) {
  const { stdout } = await execFileAsync("git", buildGitArgs(context, args), {
    cwd: defaultRepoPath,
    maxBuffer
  });
  return stdout.trimEnd();
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveGitPointer(dotGitFilePath) {
  const content = await fs.readFile(dotGitFilePath, "utf8");
  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (!match) {
    throw new Error(`Unable to read the .git file at ${dotGitFilePath}.`);
  }
  return path.resolve(path.dirname(dotGitFilePath), match[1].trim());
}

function isRemoteUrl(input) {
  if (!input) return false;
  const str = input.trim();
  if (str.startsWith("https://") || str.startsWith("http://") || str.startsWith("git://") || str.startsWith("ssh://")) {
    return true;
  }
  return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:.*$/.test(str);
}

async function ensureRemoteRepo(remoteUrl) {
  const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const remotesDir = path.join(cacheBase, "gitgraph", "remotes");
  await fs.mkdir(remotesDir, { recursive: true });

  const hash = crypto.createHash("sha256").update(remoteUrl).digest("hex").slice(0, 16);
  const cleanUrl = remoteUrl.trim().replace(/\.git$/, "");
  const parts = cleanUrl.split(/[/:]/);
  const repoName = parts[parts.length - 1] || "remote-repo";
  const repoDir = path.join(remotesDir, `${repoName}-${hash}`);

  if (await fileExists(repoDir)) {
    // Already cloned, fetch updates
    try {
      await execFileAsync("git", ["--git-dir", repoDir, "fetch", "--all", "--prune"], { maxBuffer });
    } catch {
      // Continue even if offline
    }
  } else {
    // Blobless bare clone: super fast commit DAG download without large files
    await execFileAsync("git", ["clone", "--filter=blob:none", "--bare", remoteUrl, repoDir], { maxBuffer });
  }

  return {
    requestedPath: remoteUrl,
    repoPath: repoDir,
    gitDir: repoDir,
    isBare: true,
    isRemote: true
  };
}

async function resolveGitContext(inputPath) {
  if (isRemoteUrl(inputPath)) {
    return await ensureRemoteRepo(inputPath);
  }

  const requestedPath = inputPath
    ? path.resolve(defaultRepoPath, inputPath)
    : defaultRepoPath;
  const stats = await fs.stat(requestedPath).catch(() => null);

  if (!stats) {
    throw new Error(`Path not found: ${requestedPath}.`);
  }

  if (path.basename(requestedPath) === ".git") {
    if (stats.isDirectory()) {
      return {
        requestedPath,
        repoPath: path.dirname(requestedPath),
        gitDir: requestedPath,
        isBare: false,
        isRemote: false
      };
    }
    if (stats.isFile()) {
      return {
        requestedPath,
        repoPath: path.dirname(requestedPath),
        gitDir: await resolveGitPointer(requestedPath),
        isBare: false,
        isRemote: false
      };
    }
  }

  if (stats.isDirectory()) {
    const dotGitPath = path.join(requestedPath, ".git");
    if (await fileExists(dotGitPath)) {
      const dotGitStats = await fs.stat(dotGitPath);
      if (dotGitStats.isDirectory()) {
        return {
          requestedPath,
          repoPath: requestedPath,
          gitDir: dotGitPath,
          isBare: false,
          isRemote: false
        };
      }
      if (dotGitStats.isFile()) {
        return {
          requestedPath,
          repoPath: requestedPath,
          gitDir: await resolveGitPointer(dotGitPath),
          isBare: false,
          isRemote: false
        };
      }
    }
  }

  try {
    const bare = await execFileAsync("git", ["--git-dir", requestedPath, "rev-parse", "--is-bare-repository"], {
      cwd: defaultRepoPath,
      maxBuffer
    });
    if (bare.stdout.trim() === "true") {
      return {
        requestedPath,
        repoPath: requestedPath,
        gitDir: requestedPath,
        isBare: true,
        isRemote: false
      };
    }
  } catch {
    // Fall through
  }

  throw new Error(`Git metadata not found at ${requestedPath}.`);
}

function parseRefs(rawRefs, headRefName, detachedHeadHash) {
  const refs = [];
  if (rawRefs) {
    for (const line of rawRefs.split("\n")) {
      if (!line) continue;
      const [refName, objectName, peeledObjectName, isCurrentHead] = line.split("\t");
      const target = peeledObjectName || objectName;
      const type = refName.startsWith("refs/heads/")
        ? "branch"
        : refName.startsWith("refs/remotes/")
          ? "remote"
          : refName.startsWith("refs/tags/")
            ? "tag"
            : "ref";
      const shortName = refName
        .replace(/^refs\/heads\//, "")
        .replace(/^refs\/remotes\//, "")
        .replace(/^refs\/tags\//, "");

      refs.push({
        name: refName,
        shortName,
        target,
        type,
        isCurrentHead: isCurrentHead === "*",
        isHeadRef: refName === headRefName
      });
    }
  }

  if (!headRefName && detachedHeadHash) {
    refs.push({
      name: "HEAD",
      shortName: "HEAD",
      target: detachedHeadHash,
      type: "head",
      isCurrentHead: true,
      isHeadRef: true
    });
  }

  return refs;
}

function parseCommits(rawLog, refsByTarget) {
  if (!rawLog) return [];
  return rawLog
    .split("\u001e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, parentsRaw, authorName, authorEmail, authoredAt, subject] = entry.split("\u001f");
      const parents = parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [];
      return {
        hash,
        shortHash: hash.slice(0, 8),
        parents,
        authorName,
        authorEmail,
        authoredAt,
        subject,
        refs: refsByTarget.get(hash) || []
      };
    });
}

async function getRemotes(context) {
  try {
    const rawRemotes = await runGit(context, ["remote", "-v"]);
    if (!rawRemotes) return [];
    const remotesMap = new Map();
    for (const line of rawRemotes.split("\n")) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const [name, url] = parts;
      remotesMap.set(name, { name, url });
    }
    return Array.from(remotesMap.values());
  } catch {
    return [];
  }
}

async function loadRepoData(inputPath) {
  const context = await resolveGitContext(inputPath);
  const [headRefName, headHash, remotes] = await Promise.all([
    runGit(context, ["symbolic-ref", "--quiet", "HEAD"]).catch(() => ""),
    runGit(context, ["rev-parse", "HEAD"]).catch(() => ""),
    getRemotes(context)
  ]);

  const rawRefs = await runGit(context, [
    "for-each-ref",
    "--format=%(refname)\t%(objectname)\t%(*objectname)\t%(HEAD)",
    "refs/heads",
    "refs/remotes",
    "refs/tags"
  ]);
  const refs = parseRefs(rawRefs, headRefName, headHash);
  const refsByTarget = refs.reduce((map, ref) => {
    const current = map.get(ref.target) || [];
    current.push(ref);
    map.set(ref.target, current);
    return map;
  }, new Map());

  const commitCount = Number.parseInt(await runGit(context, ["rev-list", "--all", "--count"]).catch(() => "0"), 10) || 0;
  const rawLog = commitCount > 0
    ? await runGit(context, [
        "log",
        "--all",
        "--date-order",
        "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e"
      ])
    : "";
  const commits = parseCommits(rawLog, refsByTarget);

  return {
    requestedPath: context.requestedPath,
    defaultPath: defaultRepoPath,
    repoPath: context.repoPath,
    gitDir: context.gitDir,
    isBare: context.isBare,
    isRemote: context.isRemote,
    headRefName,
    commits,
    refs,
    remotes,
    stats: {
      commitCount: commits.length,
      refCount: refs.length,
      remoteCount: remotes.length
    }
  };
}

async function loadCommitDiff(inputPath, hash) {
  const context = await resolveGitContext(inputPath);
  const [rawFiles, diff] = await Promise.all([
    runGit(context, ["show", "--name-status", "--pretty=format:", hash]).catch(() => ""),
    runGit(context, ["show", "--patch", "--stat", hash]).catch(() => "")
  ]);

  const files = [];
  for (const line of rawFiles.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 2) {
      files.push({ status: parts[0], path: parts[1] });
    }
  }

  return { hash, files, diff };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(payload);
}

async function serveStatic(response, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const targetPath = path.normalize(path.join(publicDir, cleanPath));

  if (targetPath !== publicDir && !targetPath.startsWith(`${publicDir}${path.sep}`)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(targetPath);
    const extension = path.extname(targetPath);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mimeTypes[extension] || "application/octet-stream"
    });
    response.end(content);
  } catch {
    sendText(response, 404, "Not Found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === "GET" && url.pathname === "/api/repo") {
    try {
      const payload = await loadRepoData(url.searchParams.get("repo"));
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Unable to read repository.",
        defaultPath: defaultRepoPath,
        requestedPath: url.searchParams.get("repo") || defaultRepoPath
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/diff") {
    try {
      const hash = url.searchParams.get("hash");
      if (!hash) throw new Error("Hash is required.");
      const payload = await loadCommitDiff(url.searchParams.get("repo"), hash);
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/fetch") {
    try {
      const context = await resolveGitContext(url.searchParams.get("repo"));
      await runGit(context, ["fetch", "--all", "--prune"]);
      sendJson(response, 200, { success: true });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Unable to fetch from remote."
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/context") {
    sendJson(response, 200, { defaultPath: defaultRepoPath });
    return;
  }

  if (request.method !== "GET") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  await serveStatic(response, url.pathname);
});

server.listen(port, host, () => {
  console.log(`Git Graph Web Viewer is running at http://${host}:${port}`);
});
