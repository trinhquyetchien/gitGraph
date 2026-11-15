// High contrast vibrant colors for distinct DAG branches
const LANE_COLORS = [
  "#38bdf8", // Sky Blue (main / trunk)
  "#a855f7", // Vibrant Purple (develop)
  "#10b981", // Emerald Green (feature)
  "#f59e0b", // Amber Orange
  "#ec4899", // Hot Pink
  "#06b6d4", // Cyan
  "#f97316", // Coral
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#84cc16"  // Lime
];

const layout = {
  top: 36,
  left: 28,          // Lề trái cố định, đảm bảo line luôn luôn hiển thị từ đầu
  rowHeight: 56,     // Chiều cao mỗi dòng commit chuẩn mực
  laneWidth: 32,     // Khoảng cách mỗi cột line
  bottom: 40
};

const state = {
  data: null,
  selectedHash: null,
  diffCache: new Map(),
  theme: localStorage.getItem("gitgraph-theme") || "dark",
  filters: {
    query: "",
    headOnly: false
  }
};

// DOM references
const htmlEl = document.documentElement;
const themeToggleBtn = document.querySelector("#theme-toggle-btn");
const form = document.querySelector("#repo-form");
const repoPathInput = document.querySelector("#repo-path");
const refreshBtn = document.querySelector("#refresh-btn");
const fetchBtn = document.querySelector("#fetch-btn");
const statusBanner = document.querySelector("#status-banner");
const repoStats = document.querySelector("#repo-stats");
const commitSearchInput = document.querySelector("#commit-search");
const headOnlyToggle = document.querySelector("#head-only-toggle");
const graphEmpty = document.querySelector("#graph-empty");
const graphScroll = document.querySelector("#graph-scroll");
const graphSvg = document.querySelector("#graph-svg");
const inspectorContent = document.querySelector("#inspector-content");
const selectedShortHash = document.querySelector("#selected-short-hash");

// Initialize theme
function applyTheme(theme) {
  state.theme = theme;
  htmlEl.setAttribute("data-theme", theme);
  localStorage.setItem("gitgraph-theme", theme);
}
applyTheme(state.theme);

themeToggleBtn.addEventListener("click", () => {
  applyTheme(state.theme === "dark" ? "light" : "dark");
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(message, tone = "loading") {
  statusBanner.textContent = message;
  statusBanner.className = `status-banner ${tone}`;
}

function getLaneColor(colorIndex) {
  return LANE_COLORS[colorIndex % LANE_COLORS.length];
}

function firstEmptySlot(slots) {
  const index = slots.findIndex((s) => s === null);
  return index === -1 ? slots.length : index;
}

/**
 * Intelligent DAG Column & Color Allocation:
 * Phân bổ cột (lane) và màu sắc chuyên biệt cho từng nhánh:
 * - Nhánh chính (main / master) luôn chạy trên Cột 0.
 * - Khi một nhánh mới được tạo (VD: develop, feature/...), nhánh đó rẽ sang Cột 1, Cột 2...
 * - Đường nối từ nhánh con về commit gốc của nhánh cha là một ĐƯỜNG CONG UỐN LƯỢN RÕ RỆT (S-curve fork).
 */
function assignGraphColumns(commits) {
  const byHash = new Map();
  for (const [row, commit] of commits.entries()) {
    commit.row = row;
    byHash.set(commit.hash, commit);
  }

  for (const commit of commits) {
    commit.parentCommits = commit.parents
      .map((parentHash) => byHash.get(parentHash))
      .filter(Boolean);
  }

  // 1. Lan truyền tên nhánh theo phả hệ first-parent
  const branchMap = new Map();
  for (const commit of commits) {
    const localBranch = commit.refs.find((r) => r.type === "branch");
    const remoteBranch = commit.refs.find((r) => r.type === "remote");
    const targetRef = localBranch || remoteBranch;
    if (targetRef) {
      branchMap.set(commit.hash, targetRef.shortName.replace(/^origin\//, ""));
    }
  }

  for (const commit of commits) {
    const currentBranch = branchMap.get(commit.hash);
    if (currentBranch && commit.parents.length > 0) {
      const p1 = commit.parents[0];
      if (!branchMap.has(p1)) {
        branchMap.set(p1, currentBranch);
      }
    }
  }

  for (const commit of commits) {
    commit.inferredBranch = branchMap.get(commit.hash) || "main";
  }

  // 2. Định danh các nhánh và cấp Lane riêng biệt cho từng nhánh
  // Nhánh chính 'main' / 'master' luôn được ưu tiên cột 0 (cột thân cây)
  const branchColMap = new Map();
  const branchColorMap = new Map();
  let nextCol = 0;
  let nextColorIndex = 0;

  const allBranchNames = Array.from(new Set(Array.from(branchMap.values())));
  if (allBranchNames.includes("main")) {
    branchColMap.set("main", nextCol++);
    branchColorMap.set("main", nextColorIndex++);
  } else if (allBranchNames.includes("master")) {
    branchColMap.set("master", nextCol++);
    branchColorMap.set("master", nextColorIndex++);
  }

  for (const b of allBranchNames) {
    if (!branchColMap.has(b)) {
      branchColMap.set(b, nextCol++);
      branchColorMap.set(b, nextColorIndex++);
    }
  }

  // Gán column & color cho từng commit
  for (const commit of commits) {
    const bName = commit.inferredBranch || "main";
    const col = branchColMap.has(bName) ? branchColMap.get(bName) : 0;
    const colorIdx = branchColorMap.has(bName) ? branchColorMap.get(bName) : 0;

    commit.column = col;
    commit.colorIndex = colorIdx;
    commit.color = getLaneColor(colorIdx);
  }

  // 3. Nhận diện điểm mốc rẽ nhánh (Fork Milestone)
  for (const commit of commits) {
    commit.isBranchCreation = false;
    commit.branchCreatedFrom = null;

    if (commit.parentCommits.length > 0) {
      const p1 = commit.parentCommits[0];
      if (p1.inferredBranch && p1.inferredBranch !== commit.inferredBranch) {
        commit.isBranchCreation = true;
        commit.branchCreatedFrom = p1.inferredBranch;
      }
    }
  }
}

function createSvgNode(tagName, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

function edgePath(fromX, fromY, toX, toY) {
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const bend = Math.min(50, Math.max(22, Math.abs(toY - fromY) / 2));
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + bend} ${toX} ${toY - bend} ${toX} ${toY}`;
}

function renderStats(data) {
  const typeBadge = data.isRemote ? "Remote" : "Local";
  repoStats.innerHTML = `
    <span><strong>${escapeHtml(typeBadge)}</strong></span>
    <span>•</span>
    <span>Commits: <strong>${data.stats.commitCount}</strong></span>
    <span>•</span>
    <span>HEAD: <strong>${escapeHtml(data.headRefName ? data.headRefName.replace(/^refs\/heads\//, '') : 'DETACHED')}</strong></span>
  `;
}

function getVisibleCommits(data) {
  if (!data || !data.commits) return [];
  const q = state.filters.query.trim().toLowerCase();

  return data.commits.filter((c) => {
    if (q) {
      const match =
        c.hash.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });
}

function renderGraph(visibleCommits) {
  if (!visibleCommits || visibleCommits.length === 0) {
    graphSvg.innerHTML = "";
    graphEmpty.classList.remove("hidden");
    return;
  }

  graphEmpty.classList.add("hidden");
  assignGraphColumns(visibleCommits);

  const maxColumn = Math.max(...visibleCommits.map((c) => c.column), 0);
  const laneBlockWidth = (maxColumn + 1) * layout.laneWidth;

  // Cột graph cố định, rõ ràng và nổi bật:
  // - Graph SVG đặt bên trái với độ rộng thoải mái:
  //   graphStartX = layout.left;
  //   contentStartX = graphStartX + laneBlockWidth + 32;
  const graphStartX = layout.left;
  const contentStartX = graphStartX + laneBlockWidth + 28;

  const totalWidth = Math.max(1200, contentStartX + 850);
  const height = layout.top + (visibleCommits.length - 1) * layout.rowHeight + layout.bottom;

  graphSvg.innerHTML = "";
  graphSvg.setAttribute("viewBox", `0 0 ${totalWidth} ${height}`);
  graphSvg.setAttribute("width", totalWidth);
  graphSvg.setAttribute("height", height);

  const rowBgLayer = createSvgNode("g", { class: "row-bg-layer" });
  const edgeLayer = createSvgNode("g", { class: "edge-layer" });
  const labelLayer = createSvgNode("g", { class: "label-layer" });
  const nodeLayer = createSvgNode("g", { class: "node-layer" });

  for (const commit of visibleCommits) {
    const fromX = graphStartX + commit.column * layout.laneWidth;
    const fromY = layout.top + commit.row * layout.rowHeight;
    const isSelected = commit.hash === state.selectedHash;

    // Full-row clickable background
    const rowBg = createSvgNode("rect", {
      x: 0,
      y: fromY - layout.rowHeight / 2,
      width: totalWidth,
      height: layout.rowHeight,
      class: `commit-row-bg ${isSelected ? "selected" : ""}`,
      "data-hash": commit.hash
    });
    rowBg.addEventListener("click", () => selectCommit(commit.hash));
    rowBgLayer.append(rowBg);

    // Thick prominent branch curves with dedicated colors per branch
    for (const [pIdx, parent] of commit.parentCommits.entries()) {
      const toX = graphStartX + parent.column * layout.laneWidth;
      const toY = layout.top + parent.row * layout.rowHeight;
      const strokeColor = pIdx === 0 ? commit.color : parent.color;

      const edgePathEl = createSvgNode("path", {
        d: edgePath(fromX, fromY, toX, toY),
        class: "graph-edge",
        stroke: strokeColor
      });
      edgeLayer.append(edgePathEl);
    }

    // Ref Badges (Branch/Head/Tag/Remote pills)
    let currentContentX = contentStartX;

    if (commit.refs.length > 0) {
      let badgeX = contentStartX;
      for (const ref of commit.refs) {
        let prefixIcon = "";
        if (ref.type === "branch" || ref.type === "head") prefixIcon = "⑂ ";
        else if (ref.type === "tag") prefixIcon = "🏷 ";
        else if (ref.type === "remote") prefixIcon = "☁ ";

        const displayText = prefixIcon + ref.shortName;
        const pillWidth = Math.max(54, displayText.length * 7.5 + 20);

        const refGroup = createSvgNode("g", {
          transform: `translate(${badgeX}, ${fromY - 22})`,
          class: `ref-tag-group ${ref.type}`
        });

        refGroup.append(
          createSvgNode("rect", {
            width: pillWidth,
            height: 22,
            rx: 6,
            class: `ref-tag-svg ${ref.type} ${ref.isCurrentHead ? "is-current-head" : ""}`
          })
        );

        const refText = createSvgNode("text", {
          x: pillWidth / 2,
          y: 12,
          class: "ref-tag-text"
        });
        refText.textContent = displayText;
        refGroup.append(refText);
        labelLayer.append(refGroup);

        badgeX += pillWidth + 8;
      }
      currentContentX = badgeX + 6;
    }

    // Mốc rẽ nhánh (Milestone fork badge)
    if (commit.isBranchCreation && commit.branchCreatedFrom) {
      const milestoneText = `★ Rẽ nhánh '${commit.inferredBranch}' từ '${commit.branchCreatedFrom}'`;
      const mTextWidth = Math.max(90, milestoneText.length * 6.8 + 18);

      const milestoneGroup = createSvgNode("g", {
        transform: `translate(${currentContentX}, ${fromY - 22})`,
        class: "branch-milestone-badge"
      });

      milestoneGroup.append(
        createSvgNode("rect", {
          width: mTextWidth,
          height: 22,
          rx: 5,
          class: "milestone-rect"
        })
      );

      const mText = createSvgNode("text", {
        x: mTextWidth / 2,
        y: 12,
        class: "milestone-text"
      });
      mText.textContent = milestoneText;
      milestoneGroup.append(mText);
      labelLayer.append(milestoneGroup);

      currentContentX += mTextWidth + 10;
    }

    // Commit Subject Text
    const subject = createSvgNode("text", {
      x: currentContentX,
      y: fromY - 5,
      class: "commit-subject"
    });
    subject.textContent = commit.subject || "(no subject)";
    labelLayer.append(subject);

    // Commit Meta (shortHash • Author • Date)
    const meta = createSvgNode("text", {
      x: currentContentX,
      y: fromY + 15,
      class: "commit-meta"
    });
    const dateStr = new Date(commit.authoredAt).toLocaleDateString("vi-VN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    meta.textContent = `${commit.shortHash} • ${commit.authorName} • ${dateStr}`;
    labelLayer.append(meta);

    // Commit Node Group (Regular Circle vs Merge Diamond)
    const isMerge = commit.parents && commit.parents.length > 1;
    const nodeGroup = createSvgNode("g", {
      class: `commit-node ${isMerge ? "merge-node" : "regular-node"} ${isSelected ? "selected" : ""}`,
      "data-hash": commit.hash
    });

    // Node Hit Area
    nodeGroup.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 18,
        class: "node-hit"
      })
    );

    if (isMerge) {
      // ◈ MERGE COMMIT: Hình thoi Diamond thanh thoát nổi bật
      const dSize = 8;
      const dInner = 4.8;

      nodeGroup.append(
        createSvgNode("polygon", {
          points: `${fromX},${fromY - dSize} ${fromX + dSize},${fromY} ${fromX},${fromY + dSize} ${fromX - dSize},${fromY}`,
          stroke: commit.color,
          class: "node-outer merge-diamond"
        })
      );

      nodeGroup.append(
        createSvgNode("polygon", {
          points: `${fromX},${fromY - dInner} ${fromX + dInner},${fromY} ${fromX},${fromY + dInner} ${fromX - dInner},${fromY}`,
          fill: commit.color,
          class: "node-inner merge-diamond-core"
        })
      );
    } else {
      // ● REGULAR COMMIT: Điểm tròn to rõ, viền kép tương phản cao
      nodeGroup.append(
        createSvgNode("circle", {
          cx: fromX,
          cy: fromY,
          r: 7.5,
          stroke: commit.color,
          class: "node-outer"
        })
      );

      nodeGroup.append(
        createSvgNode("circle", {
          cx: fromX,
          cy: fromY,
          r: 4.5,
          fill: commit.color,
          class: "node-inner"
        })
      );
    }

    nodeGroup.addEventListener("click", () => selectCommit(commit.hash));
    nodeLayer.append(nodeGroup);
  }

  graphSvg.append(rowBgLayer, edgeLayer, labelLayer, nodeLayer);
}
}
}

/**
 * Parse git diff text into per-file structured chunks with line numbers
 */
function parseDiffByFile(rawDiff) {
  if (!rawDiff || !rawDiff.trim()) return [];

  // Split by diff --git
  const fileChunks = rawDiff.split(/(?=^diff --git )/m);
  const result = [];

  for (const chunk of fileChunks) {
    if (!chunk.trim()) continue;
    const lines = chunk.split("\n");
    let oldPath = "";
    let newPath = "";
    const firstLine = lines[0] || "";
    const match = firstLine.match(/^diff --git a\/(.*?) b\/(.*)$/);
    if (match) {
      oldPath = match[1];
      newPath = match[2];
    }

    const diffLines = [];
    let oldLineNum = 0;
    let newLineNum = 0;
    let inHunk = false;

    for (const line of lines) {
      if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("new file mode") || line.startsWith("deleted file mode")) {
        continue;
      }

      if (line.startsWith("@@")) {
        inHunk = true;
        const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          oldLineNum = parseInt(hunkMatch[1], 10);
          newLineNum = parseInt(hunkMatch[2], 10);
        }
        diffLines.push({
          type: "hunk",
          oldNum: "...",
          newNum: "...",
          text: line
        });
      } else if (inHunk) {
        if (line.startsWith("+")) {
          diffLines.push({
            type: "add",
            oldNum: "",
            newNum: newLineNum++,
            text: line.slice(1)
          });
        } else if (line.startsWith("-")) {
          diffLines.push({
            type: "del",
            oldNum: oldLineNum++,
            newNum: "",
            text: line.slice(1)
          });
        } else {
          // Context line
          diffLines.push({
            type: "ctx",
            oldNum: oldLineNum++,
            newNum: newLineNum++,
            text: line.startsWith(" ") ? line.slice(1) : line
          });
        }
      }
    }

    result.push({
      filePath: newPath || oldPath || "file",
      lines: diffLines
    });
  }

  return result;
}

function renderDiffViewer(diffData) {
  const patch = diffData.patch || diffData.diff || "";
  const fileDiffs = parseDiffByFile(patch);

  if (fileDiffs.length === 0) {
    return `<div class="diff-empty">Không có thay đổi mã nguồn trong commit này.</div>`;
  }

  return fileDiffs
    .map((file) => {
      const lineRows = file.lines
        .map((l) => {
          return `
            <tr class="diff-row ${l.type}">
              <td class="diff-num old-num">${l.oldNum !== undefined ? l.oldNum : ""}</td>
              <td class="diff-num new-num">${l.newNum !== undefined ? l.newNum : ""}</td>
              <td class="diff-sign">${l.type === "add" ? "+" : l.type === "del" ? "-" : " "}</td>
              <td class="diff-code"><code>${escapeHtml(l.text)}</code></td>
            </tr>
          `;
        })
        .join("");

      return `
        <div class="diff-file-block">
          <div class="diff-file-header">
            <span class="file-icon">📄</span>
            <span class="file-path">${escapeHtml(file.filePath)}</span>
          </div>
          <div class="diff-table-wrapper">
            <table class="diff-table">
              <tbody>${lineRows}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");
}

async function renderCommitDetails(commit) {
  if (!commit) {
    selectedShortHash.textContent = "";
    inspectorContent.innerHTML = `<div class="empty-hint">Chọn một commit để kiểm tra chi tiết.</div>`;
    return;
  }

  selectedShortHash.textContent = commit.shortHash;

  const isMerge = commit.parents && commit.parents.length > 1;
  const mergeBadge = isMerge ? `<span class="badge-merge">MERGE</span>` : "";

  inspectorContent.innerHTML = `
    <div class="commit-card ${isMerge ? 'is-merge' : ''}">
      <div class="commit-title-row">
        <div class="commit-title">${escapeHtml(commit.subject)}</div>
        ${mergeBadge}
      </div>
      <div class="commit-meta-row">
        <span>Tác giả: <strong>${escapeHtml(commit.authorName)}</strong> &lt;${escapeHtml(commit.authorEmail)}&gt;</span>
      </div>
      <div class="commit-meta-row">
        <span>Thời gian: ${escapeHtml(new Date(commit.authoredAt).toLocaleString())}</span>
      </div>
      <div class="commit-full-hash" title="Click để copy">${escapeHtml(commit.hash)}</div>
    </div>
    <div id="diff-loading" class="empty-hint">Đang tải chi tiết thay đổi...</div>
  `;

  // Fetch diff
  let diffData = state.diffCache.get(commit.hash);
  if (!diffData) {
    try {
      const repoParam = encodeURIComponent(repoPathInput.value.trim());
      const res = await fetch(`/api/diff?repo=${repoParam}&hash=${commit.hash}`);
      diffData = await res.json();
      state.diffCache.set(commit.hash, diffData);
    } catch {
      diffData = { files: [], diff: "", patch: "", stat: "Lỗi tải diff." };
    }
  }

  const filesHtml = diffData.files && diffData.files.length > 0
    ? `
      <div class="label-heading">Files thay đổi (${diffData.files.length})</div>
      <div class="file-chips">
        ${diffData.files
          .map(
            (f) => `
          <div class="chip-item">
            <span class="chip-tag ${f.status}">${f.status}</span>
            <span class="chip-path">${escapeHtml(f.path)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `
    : "";

  const diffViewerHtml = `
    <div class="label-heading">So sánh thay đổi (Git Diff)</div>
    <div class="diff-container">
      ${renderDiffViewer(diffData)}
    </div>
  `;

  const loadingEl = document.querySelector("#diff-loading");
  if (loadingEl) {
    loadingEl.outerHTML = filesHtml + diffViewerHtml;
  }
}

function selectCommit(hash) {
  if (state.selectedHash === hash) return;
  state.selectedHash = hash;

  // Cập nhật class selected trực tiếp trên DOM mà không cần vẽ lại toàn bộ SVG
  const prevBg = graphSvg.querySelector(".commit-row-bg.selected");
  if (prevBg) prevBg.classList.remove("selected");
  const prevNode = graphSvg.querySelector(".commit-node.selected");
  if (prevNode) prevNode.classList.remove("selected");

  const newBg = graphSvg.querySelector(`.commit-row-bg[data-hash="${hash}"]`);
  if (newBg) newBg.classList.add("selected");
  const newNode = graphSvg.querySelector(`.commit-node[data-hash="${hash}"]`);
  if (newNode) newNode.classList.add("selected");

  const visible = getVisibleCommits(state.data);
  const commit = visible.find((c) => c.hash === hash);
  renderCommitDetails(commit);
}

async function loadRepo(repoInput) {
  setStatus("Đang tải dữ liệu repository (Local / Remote)...", "loading");

  try {
    const params = new URLSearchParams();
    if (repoInput) params.set("repo", repoInput);

    const res = await fetch(`/api/repo?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Không thể tải repository.");

    state.data = data;
    repoPathInput.value = data.requestedPath;
    renderStats(data);

    const visible = getVisibleCommits(data);
    state.selectedHash = visible[0]?.hash || null;
    renderGraph(visible);

    if (visible[0]) {
      renderCommitDetails(visible[0]);
    }

    setStatus(`Đã tải ${data.stats.commitCount} commits thành công.`, "success");
  } catch (err) {
    state.data = null;
    state.selectedHash = null;
    renderGraph([]);
    renderCommitDetails(null);
    setStatus(err.message, "error");
  }
}

// Event Listeners
form.addEventListener("submit", (e) => {
  e.preventDefault();
  loadRepo(repoPathInput.value.trim());
});

refreshBtn.addEventListener("click", () => {
  loadRepo(repoPathInput.value.trim());
});

commitSearchInput.addEventListener("input", () => {
  state.filters.query = commitSearchInput.value;
  const visible = getVisibleCommits(state.data);
  renderGraph(visible);
});

fetchBtn.addEventListener("click", async () => {
  const repoInput = repoPathInput.value.trim();
  setStatus("Đang fetch updates...", "loading");
  try {
    const res = await fetch(`/api/fetch?repo=${encodeURIComponent(repoInput)}`, { method: "POST" });
    if (!res.ok) throw new Error("Fetch thất bại.");
    await loadRepo(repoInput);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

// Initial boot
const contextRes = await fetch("/api/context");
const context = await contextRes.json();
repoPathInput.value = context.defaultPath;
await loadRepo(context.defaultPath);
