// Vibrant High-Contrast Colors for Branch Lines
const LANE_COLORS = [
  "#00f0ff", // Neon Cyan
  "#ff2a85", // Electric Pink
  "#ffb800", // Warm Gold
  "#00ff85", // Mint Green
  "#bd00ff", // Royal Purple
  "#3b82f6", // Sapphire Blue
  "#ff6b00", // Radiant Orange
  "#00e5ff", // Vivid Turquoise
  "#f43f5e", // Rose Red
  "#84cc16"  // Lime Green
];

const layout = {
  top: 40,
  left: 48,
  rowHeight: 64, // Comfortable row height
  laneWidth: 36,  // Lane width for distinct columns
  rightPadding: 400,
  bottom: 48
};

const state = {
  data: null,
  selectedHash: null,
  diffCache: new Map(),
  filters: {
    query: "",
    headOnly: false
  }
};

// DOM Elements
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

// Compute DAG columns for branch separation
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

// Smooth curved path between commit nodes
function edgePath(fromX, fromY, toX, toY) {
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const bend = Math.min(48, Math.max(20, Math.abs(toY - fromY) / 2));
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + bend} ${toX} ${toY - bend} ${toX} ${toY}`;
}

function renderStats(data) {
  repoStats.innerHTML = `
    <span>Commits: <strong>${data.stats.commitCount}</strong></span>
    <span>•</span>
    <span>HEAD: <strong>${escapeHtml(data.headRefName ? data.headRefName.replace(/^refs\/heads\//, '') : 'DETACHED')}</strong></span>
    <span>•</span>
    <span>Branches: <strong>${data.stats.refCount}</strong></span>
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

    // Row full-width clickable background
    const rowBg = createSvgNode("rect", {
      x: 0,
      y: fromY - layout.rowHeight / 2,
      width: width,
      height: layout.rowHeight,
      class: `commit-row-bg ${isSelected ? "selected" : ""}`
    });
    rowBg.addEventListener("click", () => selectCommit(commit.hash));
    rowBgLayer.append(rowBg);

    // Edges to parents
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

    // Ref Badges (Branch/Tag pills)
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

    // Subject text
    const subject = createSvgNode("text", {
      x: currentContentX,
      y: fromY - 6,
      class: "commit-subject"
    });
    subject.textContent = commit.subject || "(no subject)";
    labelLayer.append(subject);

    // Meta text (Hash | Author | Date)
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

    // Node group (Outer Glow + Center Circle)
    const nodeGroup = createSvgNode("g", {
      class: `commit-node ${isSelected ? "selected" : ""}`,
      "data-hash": commit.hash
    });

    // Hit test circle
    nodeGroup.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 18,
        class: "node-hit"
      })
    );

    // Outer glow ring
    nodeGroup.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 8,
        stroke: commit.color,
        class: "node-glow"
      })
    );

    // Inner bright core
    nodeGroup.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 6,
        fill: commit.color,
        class: "node-core"
      })
    );

    nodeGroup.addEventListener("click", () => selectCommit(commit.hash));
    nodeLayer.append(nodeGroup);
  }

  graphSvg.append(rowBgLayer, edgeLayer, labelLayer, nodeLayer);
}

// Format diff lines with syntax styling
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
    inspectorContent.innerHTML = `<p class="placeholder-text">Chọn một commit để xem chi tiết.</p>`;
    return;
  }

  selectedShortHash.textContent = commit.shortHash;

  // Render header card first
  inspectorContent.innerHTML = `
    <div class="commit-header-card">
      <div class="commit-title">${escapeHtml(commit.subject)}</div>
      <div class="commit-author-time">
        <span>Tác giả: <strong>${escapeHtml(commit.authorName)}</strong> &lt;${escapeHtml(commit.authorEmail)}&gt;</span>
        <span>Thời gian: ${escapeHtml(new Date(commit.authoredAt).toLocaleString())}</span>
      </div>
      <div class="full-hash" title="Click để copy">${escapeHtml(commit.hash)}</div>
    </div>
    <div id="diff-section-loading" class="placeholder-text">Đang tải diff chi tiết...</div>
  `;

  // Fetch Diff asynchronously
  let diffData = state.diffCache.get(commit.hash);
  if (!diffData) {
    try {
      const repoPath = repoPathInput.value.trim();
      const res = await fetch(`/api/diff?repo=${encodeURIComponent(repoPath)}&hash=${commit.hash}`);
      diffData = await res.json();
      state.diffCache.set(commit.hash, diffData);
    } catch {
      diffData = { files: [], diff: "Lỗi tải diff." };
    }
  }

  // Render file list and diff body
  const filesHtml = diffData.files && diffData.files.length > 0
    ? `
      <div class="section-title">Files thay đổi (${diffData.files.length})</div>
      <div class="file-list">
        ${diffData.files
          .map(
            (f) => `
          <div class="file-item">
            <span class="file-badge ${f.status}">${f.status}</span>
            <span class="file-name">${escapeHtml(f.path)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `
    : "";

  const diffHtml = `
    <div class="section-title">Git Diff</div>
    <div class="diff-container">
      <div class="diff-body">${formatDiffHtml(diffData.diff)}</div>
    </div>
  `;

  const loadingEl = document.querySelector("#diff-section-loading");
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

async function loadRepo(repoPath) {
  setStatus("Đang tải dữ liệu repository...", "loading");

  try {
    const params = new URLSearchParams();
    if (repoPath) params.set("repo", repoPath);

    const res = await fetch(`/api/repo?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Không thể tải repo.");

    state.data = data;
    repoPathInput.value = data.requestedPath;
    renderStats(data);

    const visible = getVisibleCommits(data);
    state.selectedHash = visible[0]?.hash || null;
    renderGraph(visible);

    if (visible[0]) {
      renderCommitDetails(visible[0]);
    }

    setStatus(`Đã tải ${data.stats.commitCount} commits từ ${data.repoPath}`, "success");
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
  const repoPath = repoPathInput.value.trim();
  setStatus("Đang fetch từ remotes...", "loading");
  try {
    const res = await fetch(`/api/fetch?repo=${encodeURIComponent(repoPath)}`, { method: "POST" });
    if (!res.ok) throw new Error("Fetch thất bại.");
    await loadRepo(repoPath);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

// Init
const contextRes = await fetch("/api/context");
const context = await contextRes.json();
repoPathInput.value = context.defaultPath;
await loadRepo(context.defaultPath);
