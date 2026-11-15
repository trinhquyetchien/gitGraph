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
  left: 48,
  rowHeight: 64,
  laneWidth: 38,
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

function laneColor(column) {
  return LANE_COLORS[column % LANE_COLORS.length];
}

function firstEmptyLane(lanes) {
  const index = lanes.findIndex((lane) => lane === null);
  return index === -1 ? lanes.length : index;
}

function assignGraphColumns(commits) {
  const lanes = [];
  const byHash = new Map();

  for (const [row, commit] of commits.entries()) {
    let column = lanes.indexOf(commit.hash);
    if (column === -1) {
      column = firstEmptyLane(lanes);
    }

    commit.row = row;
    commit.column = column;
    commit.color = laneColor(column);
    byHash.set(commit.hash, commit);

    if (lanes[column] === commit.hash) {
      lanes[column] = null;
    }

    if (commit.parents.length === 0) {
      lanes[column] = null;
    } else {
      const firstParent = commit.parents[0];
      const existingFirstParentLane = lanes.indexOf(firstParent);

      lanes[column] =
        existingFirstParentLane === -1 || existingFirstParentLane === column
          ? firstParent
          : null;

      for (const parentHash of commit.parents.slice(1)) {
        if (lanes.includes(parentHash)) continue;
        lanes[firstEmptyLane(lanes)] = parentHash;
      }
    }

    while (lanes.length > 0 && lanes.at(-1) === null) {
      lanes.pop();
    }
  }

  for (const commit of commits) {
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
  const contentStartX = layout.left + laneBlockWidth + 24;

  const width = Math.max(1200, contentStartX + 800);
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
    const fromX = layout.left + commit.column * layout.laneWidth;
    const fromY = layout.top + commit.row * layout.rowHeight;
    const isSelected = commit.hash === state.selectedHash;

    // Clickable row background
    const rowBg = createSvgNode("rect", {
      x: 0,
      y: fromY - layout.rowHeight / 2,
      width: width,
      height: layout.rowHeight,
      class: `commit-row-bg ${isSelected ? "selected" : ""}`
    });
    rowBg.addEventListener("click", () => selectCommit(commit.hash));
    rowBgLayer.append(rowBg);

    // Thick prominent branch curves
    for (const parent of commit.parentCommits) {
      const toX = layout.left + parent.column * layout.laneWidth;
      const toY = layout.top + parent.row * layout.rowHeight;

      edgeLayer.append(
        createSvgNode("path", {
          d: edgePath(fromX, fromY, toX, toY),
          class: "graph-edge",
          stroke: commit.color
        })
      );
    }

    // Ref Badges
    let currentContentX = contentStartX;
    if (commit.refs.length > 0) {
      let badgeX = contentStartX;
      for (const ref of commit.refs) {
        const textLen = ref.shortName.length;
        const pillWidth = Math.max(48, textLen * 7.5 + 20);

        const refGroup = createSvgNode("g", {
          transform: `translate(${badgeX}, ${fromY - 20})`
        });

        refGroup.append(
          createSvgNode("rect", {
            width: pillWidth,
            height: 20,
            class: `ref-tag-svg ${ref.type}`
          })
        );

        const refText = createSvgNode("text", {
          x: pillWidth / 2,
          y: 11,
          class: "ref-tag-text"
        });
        refText.textContent = ref.shortName;
        refGroup.append(refText);
        labelLayer.append(refGroup);

        badgeX += pillWidth + 6;
      }
      currentContentX = badgeX + 8;
    }

    // Subject
    const subject = createSvgNode("text", {
      x: currentContentX,
      y: fromY - 6,
      class: "commit-subject"
    });
    subject.textContent = commit.subject || "(no subject)";
    labelLayer.append(subject);

    // Meta (shortHash • Author • Date)
    const meta = createSvgNode("text", {
      x: currentContentX,
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

    // Big Clear Commit Node
    const nodeGroup = createSvgNode("g", {
      class: `commit-node ${isSelected ? "selected" : ""}`,
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

    // Node Outer Ring
    nodeGroup.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 8.5,
        stroke: commit.color,
        class: "node-outer"
      })
    );

    // Node Solid Core
    nodeGroup.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 5.5,
        fill: commit.color,
        class: "node-inner"
      })
    );

    nodeGroup.addEventListener("click", () => selectCommit(commit.hash));
    nodeLayer.append(nodeGroup);
  }

  graphSvg.append(rowBgLayer, edgeLayer, labelLayer, nodeLayer);
}

function formatDiffHtml(rawDiff) {
  if (!rawDiff) return `<div class="diff-line">Không có thay đổi hoặc commit khởi tạo.</div>`;

  const lines = rawDiff.split("\n");
  return lines
    .map((line) => {
      let lineClass = "";
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineClass = "add";
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        lineClass = "del";
      } else if (line.startsWith("@@")) {
        lineClass = "hunk";
      }
      return `<div class="diff-line ${lineClass}">${escapeHtml(line)}</div>`;
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

  inspectorContent.innerHTML = `
    <div class="commit-card">
      <div class="commit-title">${escapeHtml(commit.subject)}</div>
      <div class="commit-meta-row">
        <span>Tác giả: <strong>${escapeHtml(commit.authorName)}</strong> &lt;${escapeHtml(commit.authorEmail)}&gt;</span>
      </div>
      <div class="commit-meta-row">
        <span>Thời gian: ${escapeHtml(new Date(commit.authoredAt).toLocaleString())}</span>
      </div>
      <div class="commit-full-hash" title="Click để copy">${escapeHtml(commit.hash)}</div>
    </div>
    <div id="diff-loading" class="empty-hint">Đang tải diff...</div>
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
      diffData = { files: [], diff: "Lỗi tải diff." };
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
            <span>${escapeHtml(f.path)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `
    : "";

  const diffHtml = `
    <div class="label-heading">Git Diff</div>
    <div class="diff-card">
      <div class="diff-stream">${formatDiffHtml(diffData.diff)}</div>
    </div>
  `;

  const loadingEl = document.querySelector("#diff-loading");
  if (loadingEl) {
    loadingEl.outerHTML = filesHtml + diffHtml;
  }
}

function selectCommit(hash) {
  state.selectedHash = hash;
  const visible = getVisibleCommits(state.data);
  renderGraph(visible);
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
