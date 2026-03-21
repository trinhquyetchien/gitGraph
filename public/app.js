const LANE_COLORS = [
  "#d9480f",
  "#1c7ed6",
  "#2b8a3e",
  "#c2255c",
  "#5f3dc4",
  "#087f5b",
  "#e67700",
  "#364fc7"
];

const layout = {
  top: 44,
  left: 56,
  rowHeight: 80,
  laneWidth: 72,
  rightPadding: 520,
  bottom: 56
};

const state = {
  data: null,
  selectedHash: null
};

const form = document.querySelector("#repo-form");
const repoPathInput = document.querySelector("#repo-path");
const refreshButton = document.querySelector("#refresh-button");
const statusBanner = document.querySelector("#status-banner");
const repoMeta = document.querySelector("#repo-meta");
const graphEmpty = document.querySelector("#graph-empty");
const graphScroll = document.querySelector("#graph-scroll");
const graphSvg = document.querySelector("#graph-svg");
const detailsPane = document.querySelector("#details-pane");

function escapeHtml(value) {
  return value
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
        if (lanes.includes(parentHash)) {
          continue;
        }

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

  const bend = Math.min(56, Math.max(24, Math.abs(toY - fromY) / 2));
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + bend} ${toX} ${toY - bend} ${toX} ${toY}`;
}

function renderMeta(data) {
  const items = [
    { label: "Repo", value: data.repoPath },
    { label: "Git dir", value: data.gitDir },
    { label: "Commits", value: String(data.stats.commitCount) },
    { label: "Refs", value: String(data.stats.refCount) }
  ];

  repoMeta.innerHTML = items
    .map(
      (item) => `
        <article class="meta-card">
          <p>${escapeHtml(item.label)}</p>
          <strong>${escapeHtml(item.value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderDetails(commit) {
  if (!commit) {
    detailsPane.innerHTML = "<p>Chon mot node de xem hash, refs, author va parent commits.</p>";
    return;
  }

  const refMarkup = commit.refs.length
    ? commit.refs
        .map(
          (ref) => `<span class="ref-pill ${escapeHtml(ref.type)}">${escapeHtml(ref.shortName)}</span>`
        )
        .join("")
    : "<span class=\"muted\">Khong co ref tro truc tiep vao commit nay.</span>";
  const parentMarkup = commit.parents.length
    ? commit.parents
        .map((parentHash) => `<code>${escapeHtml(parentHash.slice(0, 8))}</code>`)
        .join(" ")
    : "<span class=\"muted\">Root commit</span>";

  detailsPane.innerHTML = `
    <article class="details-card">
      <p class="details-hash">${escapeHtml(commit.hash)}</p>
      <h3>${escapeHtml(commit.subject || "(khong co subject)")}</h3>
      <p class="details-author">${escapeHtml(commit.authorName)} &lt;${escapeHtml(commit.authorEmail)}&gt;</p>
      <p class="details-time">${escapeHtml(new Date(commit.authoredAt).toLocaleString())}</p>
      <div class="details-group">
        <p class="details-label">Refs</p>
        <div class="ref-wrap">${refMarkup}</div>
      </div>
      <div class="details-group">
        <p class="details-label">Parents</p>
        <div class="parent-wrap">${parentMarkup}</div>
      </div>
    </article>
  `;
}

function renderGraph(data) {
  const commits = data.commits;

  if (commits.length === 0) {
    graphSvg.innerHTML = "";
    graphScroll.classList.add("hidden");
    graphEmpty.classList.remove("hidden");
    return;
  }

  graphEmpty.classList.add("hidden");
  graphScroll.classList.remove("hidden");

  const maxColumn = Math.max(...commits.map((commit) => commit.column), 0);
  const width = layout.left + (maxColumn + 1) * layout.laneWidth + layout.rightPadding;
  const height = layout.top + Math.max(1, commits.length - 1) * layout.rowHeight + layout.bottom;

  graphSvg.innerHTML = "";
  graphSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  graphSvg.setAttribute("width", width);
  graphSvg.setAttribute("height", height);

  const edgeLayer = createSvgNode("g", { class: "edge-layer" });
  const labelLayer = createSvgNode("g", { class: "label-layer" });
  const nodeLayer = createSvgNode("g", { class: "node-layer" });
  const subjectX = layout.left + (maxColumn + 1) * layout.laneWidth + 36;

  for (const commit of commits) {
    const fromX = layout.left + commit.column * layout.laneWidth;
    const fromY = layout.top + commit.row * layout.rowHeight;

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

    if (commit.refs.length > 0) {
      let labelX = fromX + 22;

      for (const ref of commit.refs) {
        const pillWidth = Math.max(56, ref.shortName.length * 8 + 24);
        const refGroup = createSvgNode("g", {
          transform: `translate(${labelX}, ${fromY - 16})`
        });

        refGroup.append(
          createSvgNode("rect", {
            width: pillWidth,
            height: 24,
            rx: 12,
            class: `ref-tag-svg ${ref.type}`
          })
        );
        refGroup.append(
          createSvgNode("text", {
            x: pillWidth / 2,
            y: 16,
            class: "ref-tag-text"
          })
        );
        refGroup.lastChild.textContent = ref.shortName;
        labelLayer.append(refGroup);
        labelX += pillWidth + 8;
      }
    }

    const subject = createSvgNode("text", {
      x: subjectX,
      y: fromY + 5,
      class: "commit-subject"
    });
    subject.textContent = commit.subject || "(khong co subject)";
    labelLayer.append(subject);

    const meta = createSvgNode("text", {
      x: subjectX,
      y: fromY + 28,
      class: "commit-meta"
    });
    meta.textContent = `${commit.shortHash}  ${new Date(commit.authoredAt).toLocaleString()}  ${commit.authorName}`;
    labelLayer.append(meta);

    const hitArea = createSvgNode("g", {
      class: `commit-node ${state.selectedHash === commit.hash ? "selected" : ""}`,
      "data-hash": commit.hash,
      tabindex: 0
    });

    hitArea.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 16,
        class: "node-hit"
      })
    );
    hitArea.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 10,
        fill: commit.color,
        class: "node-core"
      })
    );
    hitArea.append(
      createSvgNode("circle", {
        cx: fromX,
        cy: fromY,
        r: 4,
        class: "node-center"
      })
    );
    hitArea.addEventListener("click", () => selectCommit(commit.hash));
    hitArea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCommit(commit.hash);
      }
    });
    nodeLayer.append(hitArea);
  }

  graphSvg.append(edgeLayer, labelLayer, nodeLayer);
}

function render() {
  if (!state.data) {
    renderMeta({
      repoPath: "-",
      gitDir: "-",
      stats: { commitCount: 0, refCount: 0 }
    });
    renderGraph({ commits: [] });
    renderDetails(null);
    return;
  }

  renderMeta(state.data);
  renderGraph(state.data);
  const selectedCommit =
    state.data.commits.find((commit) => commit.hash === state.selectedHash) || state.data.commits[0] || null;

  if (selectedCommit && state.selectedHash !== selectedCommit.hash) {
    state.selectedHash = selectedCommit.hash;
    renderGraph(state.data);
  }

  renderDetails(selectedCommit);
}

function selectCommit(hash) {
  state.selectedHash = hash;
  render();
}

async function loadContext() {
  const response = await fetch("/api/context");
  const payload = await response.json();
  repoPathInput.value = payload.defaultPath;
}

async function loadRepo(repoPath) {
  setStatus("Dang nap commit graph...", "loading");

  try {
    const params = new URLSearchParams();

    if (repoPath) {
      params.set("repo", repoPath);
    }

    const response = await fetch(`/api/repo?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Khong the nap du lieu repo.");
    }

    assignGraphColumns(payload.commits);
    state.data = payload;
    state.selectedHash = payload.commits[0]?.hash || null;
    repoPathInput.value = payload.requestedPath;
    setStatus(`Da nap ${payload.stats.commitCount} commit tu ${payload.repoPath}`, "success");
    render();
  } catch (error) {
    state.data = null;
    state.selectedHash = null;
    setStatus(error instanceof Error ? error.message : "Khong the nap repo Git.", "error");
    render();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadRepo(repoPathInput.value.trim());
});

refreshButton.addEventListener("click", () => {
  loadRepo(repoPathInput.value.trim());
});

await loadContext();
await loadRepo(repoPathInput.value.trim());
