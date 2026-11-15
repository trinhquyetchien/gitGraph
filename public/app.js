// High contrast vibrant colors for distinct DAG branches
const LANE_COLORS = [
  "#0ea5e9", // Sky Blue
  "#ec4899", // Vivid Pink
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#84cc16"  // Lime
];

const layout = {
  top: 40,
  leftColWidth: 320, // Không gian bên trái dành cho Branch Names & Refs
  rowHeight: 64,
  laneWidth: 40,
  bottom: 48
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
 * Mỗi khi nhánh rẽ (branch fork), nhánh mới được cấp một Lane riêng
 * và một MÃ MÀU MỚI RIÊNG BIỆT độc lập với nhánh chính.
 */
function assignGraphColumns(commits) {
  const lanes = []; // commit hash expected on lane
  const laneColors = []; // colorIndex assigned to lane
  const byHash = new Map();
  let nextColorIndex = 0;

  for (const [row, commit] of commits.entries()) {
    byHash.set(commit.hash, commit);
    commit.row = row;

    let col = lanes.indexOf(commit.hash);
    let colorIdx;

    if (col === -1) {
      col = firstEmptySlot(lanes);
      colorIdx = nextColorIndex++;
      lanes[col] = commit.hash;
      laneColors[col] = colorIdx;
    } else {
      colorIdx = laneColors[col];
    }

    commit.column = col;
    commit.colorIndex = colorIdx;
    commit.color = getLaneColor(colorIdx);

    lanes[col] = null;

    if (commit.parents.length === 0) {
      lanes[col] = null;
      laneColors[col] = null;
    } else {
      const firstParent = commit.parents[0];
      const existingFirstCol = lanes.indexOf(firstParent);

      if (existingFirstCol === -1 || existingFirstCol === col) {
        lanes[col] = firstParent;
        laneColors[col] = colorIdx;
      }

      // Subsequent parents (branch forks) get NEW DISTINCT COLORS & LANES
      for (const parentHash of commit.parents.slice(1)) {
        if (lanes.includes(parentHash)) continue;
        const newCol = firstEmptySlot(lanes);
        const forkColor = nextColorIndex++;
        lanes[newCol] = parentHash;
        laneColors[newCol] = forkColor;
      }
    }

    while (lanes.length > 0 && lanes.at(-1) === null) {
      lanes.pop();
      laneColors.pop();
    }
  }

  // Propagate inferred branch names along commit lineages
  const branchMap = new Map();
  // 1. Seed with explicit branch refs (prefer local branch over remote)
  for (const commit of commits) {
    const localBranch = commit.refs.find((r) => r.type === "branch");
    const remoteBranch = commit.refs.find((r) => r.type === "remote");
    const targetRef = localBranch || remoteBranch;
    if (targetRef) {
      branchMap.set(commit.hash, targetRef.shortName.replace(/^origin\//, ""));
    }
  }

  // 2. Propagate down first-parent chain
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
    commit.inferredBranch = branchMap.get(commit.hash) || "";
    commit.parentCommits = commit.parents
      .map((parentHash) => byHash.get(parentHash))
      .filter(Boolean);
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

  // Biểu đồ nằm ở giữa:
  // - Cột bên trái (leftColWidth): dành cho Branch Name & Ref Tags (căn phải về phía line)
  // - Cột giữa (graphCenterX ...): chứa các đường Line DAG & Nodes
  // - Cột bên phải (rightColX ...): chứa Commit Subject & Meta (Hash, Author, Date)
  const graphStartX = layout.leftColWidth + 24;
  const contentStartX = graphStartX + laneBlockWidth + 32;

  const width = Math.max(1280, contentStartX + 800);
  const height = layout.top + (visibleCommits.length - 1) * layout.rowHeight + layout.bottom;

  graphSvg.innerHTML = "";
  graphSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  graphSvg.setAttribute("width", width);
  graphSvg.setAttribute("height", height);

  const rowBgLayer = createSvgNode("g", { class: "row-bg-layer" });
  const edgeLayer = createSvgNode("g", { class: "edge-layer" });
  const labelLayer = createSvgNode("g", { class: "label-layer" });
  const nodeLayer = createSvgNode("g", { class: "node-layer" });

  for (const commit of visibleCommits) {
    const fromX = graphStartX + commit.column * layout.laneWidth;
    const fromY = layout.top + commit.row * layout.rowHeight;
    const isSelected = commit.hash === state.selectedHash;

    // Clickable row background
    const rowBg = createSvgNode("rect", {
      x: 0,
      y: fromY - layout.rowHeight / 2,
      width: width,
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

      edgeLayer.append(
        createSvgNode("path", {
          d: edgePath(fromX, fromY, toX, toY),
          class: "graph-edge",
          stroke: strokeColor
        })
      );
    }

    // --- CỘT BÊN TRÁI: Branch Name & Ref Tags (Căn về phía line đồ thị ở giữa) ---
    let leftItemsEndX = graphStartX - 16;

    // Ref Badges (xếp từ phải qua trái)
    if (commit.refs.length > 0) {
      let curRefRightX = leftItemsEndX;
      for (const ref of [...commit.refs].reverse()) {
        let prefixIcon = "";
        if (ref.type === "branch" || ref.type === "head") {
          prefixIcon = "⑂ ";
        } else if (ref.type === "tag") {
          prefixIcon = "🏷 ";
        } else if (ref.type === "remote") {
          prefixIcon = "☁ ";
        }

        const displayText = prefixIcon + ref.shortName;
        const textLen = displayText.length;
        const pillWidth = Math.max(54, textLen * 7.2 + 18);
        const badgeX = curRefRightX - pillWidth;

        const refGroup = createSvgNode("g", {
          transform: `translate(${badgeX}, ${fromY - 21})`,
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

        curRefRightX = badgeX - 8;
      }
      leftItemsEndX = curRefRightX;
    } else {
      // Nếu commit không có ref trực tiếp, hiển thị tên nhánh ngầm suy luận ở bên trái
      const prevCommit = visibleCommits[commit.row - 1];
      const isBranchStartOrChange =
        commit.inferredBranch &&
        (!prevCommit || prevCommit.inferredBranch !== commit.inferredBranch || prevCommit.column !== commit.column);

      if (isBranchStartOrChange) {
        const branchLabel = createSvgNode("g", {
          transform: `translate(${leftItemsEndX}, ${fromY})`,
          class: "lane-branch-tag"
        });

        const bText = createSvgNode("text", {
          x: 0,
          y: 4,
          class: "lane-branch-text",
          fill: commit.color
        });
        bText.textContent = commit.inferredBranch;
        branchLabel.append(bText);
        labelLayer.append(branchLabel);
      }
    }

    // --- CỘT BÊN PHẢI: Commit Subject & Meta ---
    // Subject
    const subject = createSvgNode("text", {
      x: contentStartX,
      y: fromY - 6,
      class: "commit-subject"
    });
    subject.textContent = commit.subject || "(no subject)";
    labelLayer.append(subject);

    // Meta (shortHash • Author • Date)
    const meta = createSvgNode("text", {
      x: contentStartX,
      y: fromY + 14,
      class: "commit-meta"
    });
    const dateStr = new Date(commit.authoredAt).toLocaleString("vi-VN", {
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
      // ◈ MERGE COMMIT: Hình thoi Diamond viền đôi sang trọng
      const dSize = 9;
      const dInner = 5.5;

      // Outer diamond ring
      nodeGroup.append(
        createSvgNode("polygon", {
          points: `${fromX},${fromY - dSize} ${fromX + dSize},${fromY} ${fromX},${fromY + dSize} ${fromX - dSize},${fromY}`,
          stroke: commit.color,
          class: "node-outer merge-diamond"
        })
      );

      // Inner solid diamond
      nodeGroup.append(
        createSvgNode("polygon", {
          points: `${fromX},${fromY - dInner} ${fromX + dInner},${fromY} ${fromX},${fromY + dInner} ${fromX - dInner},${fromY}`,
          fill: commit.color,
          class: "node-inner merge-diamond-core"
        })
      );
    } else {
      // ● REGULAR COMMIT: Hình tròn tiêu chuẩn
      nodeGroup.append(
        createSvgNode("circle", {
          cx: fromX,
          cy: fromY,
          r: 8.5,
          stroke: commit.color,
          class: "node-outer"
        })
      );

      nodeGroup.append(
        createSvgNode("circle", {
          cx: fromX,
          cy: fromY,
          r: 5.5,
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
