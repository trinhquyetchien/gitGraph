import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRepoData, loadCommitDiff } from "./server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "dist");
const publicDir = path.join(__dirname, "public");

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function exportStatic() {
  console.log("Exporting static site for GitHub Pages...");
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  // 1. Copy public assets
  await copyDir(publicDir, outDir);

  // 2. Export /api/context.json
  const apiDir = path.join(outDir, "api");
  await fs.mkdir(apiDir, { recursive: true });
  await fs.writeFile(
    path.join(apiDir, "context.json"),
    JSON.stringify({ defaultPath: "trinhquyetchien/gitGraph" }, null, 2)
  );

  // 3. Export /api/repo.json
  const repoData = await loadRepoData();
  await fs.writeFile(
    path.join(apiDir, "repo.json"),
    JSON.stringify(repoData, null, 2)
  );
  console.log(`Exported repo metadata with ${repoData.commits.length} commits.`);

  // 4. Export /api/diff/<hash>.json for each commit
  const diffDir = path.join(apiDir, "diff");
  await fs.mkdir(diffDir, { recursive: true });
  for (const commit of repoData.commits) {
    const diffData = await loadCommitDiff(null, commit.hash);
    await fs.writeFile(
      path.join(diffDir, `${commit.hash}.json`),
      JSON.stringify(diffData, null, 2)
    );
  }
  console.log(`Exported diffs for ${repoData.commits.length} commits.`);

  console.log("Static export completed successfully in ./dist");
}

exportStatic().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
