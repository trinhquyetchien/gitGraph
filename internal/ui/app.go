package ui

import (
	"fmt"
	"strings"

	"github.com/atotto/clipboard"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"gitgraph/internal/git"
	"gitgraph/internal/graph"
	"gitgraph/internal/model"
)

type FocusArea int

const (
	FocusCommits FocusArea = iota
	FocusDiff
)

type StateModel struct {
	ctx          *git.Context
	repoInfo     *model.RepoInfo
	commits      []*model.Commit
	selectedIdx  int
	
	// Detail & Diff
	activeDetail *model.CommitDetail
	diffViewport viewport.Model
	diffReady    bool

	// Search & Filter
	searchBar   textinput.Model
	isSearching bool
	searchQuery string
	headOnly    bool

	// Open Remote URL Modal
	urlInput  textinput.Model
	isOpenURL bool

	// Layout & Dimensions
	width     int
	height    int
	focusArea FocusArea

	// Status & notification
	statusMsg  string
	statusTone string // "info", "success", "error"

	// Key help modal
	showHelp bool
}

var (
	laneColors = []lipgloss.Color{
		lipgloss.Color("#38BDF8"), // Cyan
		lipgloss.Color("#A855F7"), // Purple
		lipgloss.Color("#F59E0B"), // Amber
		lipgloss.Color("#10B981"), // Emerald
		lipgloss.Color("#EC4899"), // Pink
		lipgloss.Color("#3B82F6"), // Blue
		lipgloss.Color("#F97316"), // Orange
		lipgloss.Color("#14B8A6"), // Teal
	}

	headerStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#FFFFFF")).
			Background(lipgloss.Color("#4338CA")).
			Padding(0, 1)

	headerSubStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#9CA3AF")).
			Background(lipgloss.Color("#1F2937")).
			Padding(0, 1)

	boxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("#374151")).
			Padding(0)

	activeBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("#6366F1")).
			Padding(0)

	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#E0E7FF")).
			Background(lipgloss.Color("#3730A3")).
			Padding(0, 1)

	selectedRowStyle = lipgloss.NewStyle().
				Background(lipgloss.Color("#312E81")).
				Foreground(lipgloss.Color("#FFFFFF")).
				Bold(true)

	normalRowStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#E5E7EB"))

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#6B7280"))

	branchTagStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#0284C7")).
			Background(lipgloss.Color("#E0F2FE")).
			Bold(true).
			Padding(0, 1)

	headTagStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#B45309")).
			Background(lipgloss.Color("#FEF3C7")).
			Bold(true).
			Padding(0, 1)

	tagTagStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#047857")).
			Background(lipgloss.Color("#D1FAE5")).
			Bold(true).
			Padding(0, 1)

	remoteTagStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#6D28D9")).
			Background(lipgloss.Color("#EDE9FE")).
			Bold(true).
			Padding(0, 1)

	diffAddStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#10B981"))

	diffDelStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#EF4444"))

	diffHunkStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#38BDF8"))
)

type reloadMsg struct {
	info *model.RepoInfo
	err  error
}

type fetchDoneMsg struct {
	err error
}

type openRemoteMsg struct {
	ctx *git.Context
	err error
}

type commitDetailMsg struct {
	detail *model.CommitDetail
	err    error
}

func InitialModel(inputPath string) (*StateModel, error) {
	ctx, err := git.ResolveContext(inputPath)
	if err != nil {
		return nil, err
	}

	ti := textinput.New()
	ti.Placeholder = "Search commits by subject, author, hash..."
	ti.CharLimit = 100

	uiInput := textinput.New()
	uiInput.Placeholder = "Enter HTTPS or SSH repo URL (e.g. https://github.com/user/repo.git)"
	uiInput.CharLimit = 200

	m := &StateModel{
		ctx:         ctx,
		focusArea:   FocusCommits,
		searchBar:   ti,
		urlInput:    uiInput,
		statusMsg:   "Loading repository...",
		statusTone:  "info",
		selectedIdx: 0,
	}

	return m, nil
}

func (m StateModel) Init() tea.Cmd {
	return tea.Batch(
		loadRepoCmd(m.ctx),
		textinput.Blink,
	)
}

func loadRepoCmd(ctx *git.Context) tea.Cmd {
	return func() tea.Msg {
		info, err := git.LoadRepoInfo(ctx)
		return reloadMsg{info: info, err: err}
	}
}

func openRemoteCmd(remoteURL string) tea.Cmd {
	return func() tea.Msg {
		newCtx, err := git.EnsureRemoteRepo(remoteURL, nil)
		return openRemoteMsg{ctx: newCtx, err: err}
	}
}

func loadDetailCmd(ctx *git.Context, c *model.Commit) tea.Cmd {
	return func() tea.Msg {
		if c == nil {
			return commitDetailMsg{detail: nil}
		}
		det, err := git.LoadCommitDetail(ctx, c)
		return commitDetailMsg{detail: det, err: err}
	}
}

func fetchCmd(ctx *git.Context) tea.Cmd {
	return func() tea.Msg {
		err := git.FetchRemotes(ctx)
		return fetchDoneMsg{err: err}
	}
}

func (m StateModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.updateViewportSize()

	case openRemoteMsg:
		if msg.err != nil {
			m.statusMsg = fmt.Sprintf("Remote failed: %v", msg.err)
			m.statusTone = "error"
		} else {
			m.ctx = msg.ctx
			m.statusMsg = "Remote repository ready! Loading commits..."
			m.statusTone = "info"
			cmds = append(cmds, loadRepoCmd(m.ctx))
		}

	case reloadMsg:
		if msg.err != nil {
			m.statusMsg = fmt.Sprintf("Error: %v", msg.err)
			m.statusTone = "error"
		} else {
			m.repoInfo = msg.info
			m.filterCommits()
			m.statusMsg = fmt.Sprintf("Loaded %d commits | HEAD: %s", m.repoInfo.CommitCount, m.repoInfo.HeadRefName)
			m.statusTone = "success"

			if len(m.commits) > 0 {
				if m.selectedIdx >= len(m.commits) {
					m.selectedIdx = 0
				}
				cmds = append(cmds, loadDetailCmd(m.ctx, m.commits[m.selectedIdx]))
			}
		}

	case fetchDoneMsg:
		if msg.err != nil {
			m.statusMsg = fmt.Sprintf("Fetch failed: %v", msg.err)
			m.statusTone = "error"
		} else {
			m.statusMsg = "Fetch complete! Reloading repository..."
			m.statusTone = "success"
			cmds = append(cmds, loadRepoCmd(m.ctx))
		}

	case commitDetailMsg:
		if msg.err == nil && msg.detail != nil {
			m.activeDetail = msg.detail
			m.diffViewport.SetContent(formatDiffContent(msg.detail.FullDiff))
			m.diffViewport.GotoTop()
		}

	case tea.KeyMsg:
		// When Remote URL Modal is active
		if m.isOpenURL {
			switch msg.String() {
			case "enter":
				m.isOpenURL = false
				val := strings.TrimSpace(m.urlInput.Value())
				if val != "" {
					m.statusMsg = "Connecting and cloning remote repository topology..."
					m.statusTone = "info"
					cmds = append(cmds, openRemoteCmd(val))
				}
				return m, tea.Batch(cmds...)
			case "esc":
				m.isOpenURL = false
				return m, nil
			default:
				var cmd tea.Cmd
				m.urlInput, cmd = m.urlInput.Update(msg)
				return m, cmd
			}
		}

		// When search input is active
		if m.isSearching {
			switch msg.String() {
			case "enter":
				m.isSearching = false
				m.searchQuery = m.searchBar.Value()
				m.filterCommits()
				m.selectedIdx = 0
				if len(m.commits) > 0 {
					cmds = append(cmds, loadDetailCmd(m.ctx, m.commits[0]))
				}
				return m, nil
			case "esc":
				m.isSearching = false
				m.searchBar.SetValue(m.searchQuery)
				return m, nil
			default:
				var cmd tea.Cmd
				m.searchBar, cmd = m.searchBar.Update(msg)
				m.searchQuery = m.searchBar.Value()
				m.filterCommits()
				return m, cmd
			}
		}

		// When Help is shown
		if m.showHelp {
			if msg.String() == "?" || msg.String() == "esc" || msg.String() == "q" {
				m.showHelp = false
			}
			return m, nil
		}

		// Global Key Navigation
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit

		case "?":
			m.showHelp = true
			return m, nil

		case "o":
			// Open remote Git repo URL modal
			m.isOpenURL = true
			m.urlInput.Reset()
			m.urlInput.Focus()
			return m, textinput.Blink

		case "/":
			m.isSearching = true
			m.searchBar.Focus()
			return m, textinput.Blink

		case "tab":
			// Cycle panels: Commits <-> Diff
			if m.focusArea == FocusCommits {
				m.focusArea = FocusDiff
			} else {
				m.focusArea = FocusCommits
			}

		case "y":
			// Yank / Copy commit SHA to clipboard
			if len(m.commits) > 0 && m.selectedIdx < len(m.commits) {
				hash := m.commits[m.selectedIdx].Hash
				if err := clipboard.WriteAll(hash); err == nil {
					m.statusMsg = fmt.Sprintf("Copied commit hash %s to clipboard!", m.commits[m.selectedIdx].ShortHash)
					m.statusTone = "success"
				} else {
					m.statusMsg = fmt.Sprintf("Hash: %s", hash)
					m.statusTone = "info"
				}
			}

		case "h":
			// Toggle HEAD only
			m.headOnly = !m.headOnly
			m.filterCommits()
			m.selectedIdx = 0
			if len(m.commits) > 0 {
				cmds = append(cmds, loadDetailCmd(m.ctx, m.commits[0]))
			}

		case "r":
			m.statusMsg = "Refreshing repository..."
			m.statusTone = "info"
			cmds = append(cmds, loadRepoCmd(m.ctx))

		case "f":
			m.statusMsg = "Fetching remotes..."
			m.statusTone = "info"
			cmds = append(cmds, fetchCmd(m.ctx))

		case "up", "k":
			if m.focusArea == FocusCommits && len(m.commits) > 0 {
				if m.selectedIdx > 0 {
					m.selectedIdx--
					cmds = append(cmds, loadDetailCmd(m.ctx, m.commits[m.selectedIdx]))
				}
			} else if m.focusArea == FocusDiff {
				m.diffViewport.LineUp(1)
			}

		case "down", "j":
			if m.focusArea == FocusCommits && len(m.commits) > 0 {
				if m.selectedIdx < len(m.commits)-1 {
					m.selectedIdx++
					cmds = append(cmds, loadDetailCmd(m.ctx, m.commits[m.selectedIdx]))
				}
			} else if m.focusArea == FocusDiff {
				m.diffViewport.LineDown(1)
			}

		case "pgup":
			if m.focusArea == FocusDiff {
				m.diffViewport.HalfViewUp()
			} else if m.focusArea == FocusCommits && len(m.commits) > 0 {
				m.selectedIdx -= 10
				if m.selectedIdx < 0 {
					m.selectedIdx = 0
				}
				cmds = append(cmds, loadDetailCmd(m.ctx, m.commits[m.selectedIdx]))
			}

		case "pgdown":
			if m.focusArea == FocusDiff {
				m.diffViewport.HalfViewDown()
			} else if m.focusArea == FocusCommits && len(m.commits) > 0 {
				m.selectedIdx += 10
				if m.selectedIdx >= len(m.commits) {
					m.selectedIdx = len(m.commits) - 1
				}
				cmds = append(cmds, loadDetailCmd(m.ctx, m.commits[m.selectedIdx]))
			}
		}
	}

	return m, tea.Batch(cmds...)
}

func (m *StateModel) updateViewportSize() {
	rightWidth := m.width / 2
	if rightWidth < 40 {
		rightWidth = 40
	}
	diffHeight := m.height - 18
	if diffHeight < 5 {
		diffHeight = 5
	}

	if !m.diffReady {
		m.diffViewport = viewport.New(rightWidth-4, diffHeight)
		m.diffReady = true
	} else {
		m.diffViewport.Width = rightWidth - 4
		m.diffViewport.Height = diffHeight
	}
}

func (m *StateModel) filterCommits() {
	if m.repoInfo == nil {
		m.commits = nil
		return
	}

	var filtered []*model.Commit
	q := strings.ToLower(strings.TrimSpace(m.searchQuery))

	for _, c := range m.repoInfo.Commits {
		if q != "" {
			match := strings.Contains(strings.ToLower(c.Subject), q) ||
				strings.Contains(strings.ToLower(c.AuthorName), q) ||
				strings.Contains(strings.ToLower(c.Hash), q)
			if !match {
				continue
			}
		}
		filtered = append(filtered, c)
	}

	graph.AssignColumns(filtered)
	m.commits = filtered
}

func (m StateModel) View() string {
	if m.width == 0 || m.height == 0 {
		return "Initializing Git Graph..."
	}

	if m.showHelp {
		return m.renderHelpView()
	}

	if m.isOpenURL {
		return m.renderOpenURLModal()
	}

	// 1. Top Header Bar
	header := m.renderHeader()

	// 2. Middle Main Area (Left: Commit Graph, Right: Commit Details & Diff)
	mainAreaHeight := m.height - 6
	if mainAreaHeight < 10 {
		mainAreaHeight = 10
	}

	leftWidth := (m.width * 55) / 100
	rightWidth := m.width - leftWidth - 2

	leftPanel := m.renderLeftPanel(leftWidth, mainAreaHeight)
	rightPanel := m.renderRightPanel(rightWidth, mainAreaHeight)

	mainArea := lipgloss.JoinHorizontal(lipgloss.Top, leftPanel, rightPanel)

	// 3. Search Bar & Status Bar
	searchLine := m.renderSearchBar()
	statusBar := m.renderStatusBar()

	return lipgloss.JoinVertical(lipgloss.Left, header, searchLine, mainArea, statusBar)
}

func (m StateModel) renderHeader() string {
	repoName := m.ctx.RepoPath
	if len(repoName) > 40 {
		repoName = "..." + repoName[len(repoName)-37:]
	}

	title := headerStyle.Render(" GIT GRAPH TUI ")
	repoBadge := headerSubStyle.Render(fmt.Sprintf(" Repo: %s ", repoName))

	var headBadge string
	if m.repoInfo != nil && m.repoInfo.HeadRefName != "" {
		headBadge = headerSubStyle.Render(fmt.Sprintf(" HEAD: %s ", strings.TrimPrefix(m.repoInfo.HeadRefName, "refs/heads/")))
	}

	shortcuts := dimStyle.Render("  [?] Help  [o] Open URL  [Tab] Pane  [/] Search  [y] Yank SHA  [r] Refresh  [q] Quit")

	return lipgloss.JoinHorizontal(lipgloss.Center, title, repoBadge, headBadge, shortcuts)
}

func (m StateModel) renderSearchBar() string {
	if m.isSearching {
		return lipgloss.NewStyle().
			Background(lipgloss.Color("#1E293B")).
			Foreground(lipgloss.Color("#38BDF8")).
			Padding(0, 1).
			Render("Search: " + m.searchBar.View())
	}

	if m.searchQuery != "" {
		filterTag := lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FCD34D")).
			Render(fmt.Sprintf(" Filter: \"%s\" (Press [/] to change, [Esc] to clear) ", m.searchQuery))
		return filterTag
	}

	return ""
}

func (m StateModel) renderOpenURLModal() string {
	modalBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#6366F1")).
		Background(lipgloss.Color("#0F172A")).
		Padding(1, 2).
		Width(70)

	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#38BDF8")).Render("Open Remote Git Repository")
	desc := dimStyle.Render("Enter an HTTPS or SSH repository link to load and explore:")
	inputBox := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("#4F46E5")).
		Padding(0, 1).
		Render(m.urlInput.View())

	hint := dimStyle.Render("Press [Enter] to clone & open, or [Esc] to cancel.")

	content := lipgloss.JoinVertical(lipgloss.Left, title, desc, "", inputBox, "", hint)
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, modalBox.Render(content))
}

func (m StateModel) renderLeftPanel(width, height int) string {
	var b strings.Builder

	pTitle := titleStyle.Render(" COMMIT TOPOLOGY & GRAPH ")
	b.WriteString(pTitle + "\n")

	visibleRows := height - 3
	if visibleRows < 1 {
		visibleRows = 1
	}

	startIdx := 0
	if m.selectedIdx >= visibleRows {
		startIdx = m.selectedIdx - visibleRows + 1
	}
	endIdx := startIdx + visibleRows
	if endIdx > len(m.commits) {
		endIdx = len(m.commits)
	}

	maxCols := 1
	for _, c := range m.commits {
		if c.Column+1 > maxCols {
			maxCols = c.Column + 1
		}
	}
	if maxCols > 8 {
		maxCols = 8
	}

	for i := startIdx; i < endIdx; i++ {
		c := m.commits[i]
		isSelected := i == m.selectedIdx

		// Graph prefix with real connected tree lines & colored nodes
		var graphPart string
		if c.GraphPrefix != "" {
			graphPart = graph.FormatGraphPrefix(c.GraphPrefix)
		} else {
			dotColor := laneColors[c.ColorIndex%len(laneColors)]
			dot := lipgloss.NewStyle().Foreground(dotColor).Bold(true).Render("⬤")
			indent := strings.Repeat("┃ ", c.Column)
			graphPart = indent + dot + " "
		}

		// Ref badges
		var badges []string
		for _, r := range c.Refs {
			switch r.Type {
			case "branch":
				badges = append(badges, branchTagStyle.Render(r.ShortName))
			case "head":
				badges = append(badges, headTagStyle.Render(r.ShortName))
			case "tag":
				badges = append(badges, tagTagStyle.Render(r.ShortName))
			case "remote":
				badges = append(badges, remoteTagStyle.Render(r.ShortName))
			}
		}
		refStr := ""
		if len(badges) > 0 {
			refStr = strings.Join(badges, " ") + " "
		}

		hashPart := dimStyle.Render(c.ShortHash)
		subject := c.Subject
		availableWidth := width - len(graphPart) - len(c.ShortHash) - lipgloss.Width(refStr) - 6
		if availableWidth > 5 && len(subject) > availableWidth {
			subject = subject[:availableWidth-3] + "..."
		}

		rowContent := fmt.Sprintf("%s %s %s%s", graphPart, hashPart, refStr, subject)

		if isSelected {
			b.WriteString(selectedRowStyle.Width(width - 2).Render(rowContent) + "\n")
		} else {
			b.WriteString(normalRowStyle.Width(width - 2).Render(rowContent) + "\n")
		}
	}

	style := boxStyle
	if m.focusArea == FocusCommits {
		style = activeBoxStyle
	}

	return style.Width(width).Height(height).Render(b.String())
}

func (m StateModel) renderRightPanel(width, height int) string {
	var b strings.Builder

	pTitle := titleStyle.Render(" COMMIT INSPECTOR & DIFF ")
	b.WriteString(pTitle + "\n")

	if m.activeDetail == nil {
		b.WriteString(dimStyle.Render("\n Select a commit on the left to inspect."))
	} else {
		c := m.activeDetail.Commit
		b.WriteString(fmt.Sprintf("%s %s\n", lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#F43F5E")).Render(c.Hash), dimStyle.Render(c.AuthoredAt.Format("2006-01-02 15:04"))))
		b.WriteString(fmt.Sprintf("Author: %s <%s>\n", c.AuthorName, c.AuthorEmail))
		b.WriteString(fmt.Sprintf("Message: %s\n", lipgloss.NewStyle().Bold(true).Render(c.Subject)))

		if len(m.activeDetail.Files) > 0 {
			b.WriteString(fmt.Sprintf("Changed files (%d):\n", len(m.activeDetail.Files)))
			for idx, f := range m.activeDetail.Files {
				if idx >= 4 {
					b.WriteString(dimStyle.Render(fmt.Sprintf("  ...and %d more files\n", len(m.activeDetail.Files)-4)))
					break
				}
				statusColor := lipgloss.Color("#10B981")
				if f.Status == "D" {
					statusColor = lipgloss.Color("#EF4444")
				} else if f.Status == "M" {
					statusColor = lipgloss.Color("#F59E0B")
				}
				b.WriteString(fmt.Sprintf("  %s %s\n", lipgloss.NewStyle().Foreground(statusColor).Render(f.Status), f.Path))
			}
		}

		b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("#4F46E5")).Render("─── Diff ───\n"))
		b.WriteString(m.diffViewport.View())
	}

	style := boxStyle
	if m.focusArea == FocusDiff {
		style = activeBoxStyle
	}

	return style.Width(width).Height(height).Render(b.String())
}

func (m StateModel) renderStatusBar() string {
	toneColor := lipgloss.Color("#38BDF8")
	if m.statusTone == "error" {
		toneColor = lipgloss.Color("#EF4444")
	} else if m.statusTone == "success" {
		toneColor = lipgloss.Color("#10B981")
	}

	status := lipgloss.NewStyle().Foreground(toneColor).Render("● " + m.statusMsg)
	return lipgloss.NewStyle().
		Background(lipgloss.Color("#111827")).
		Width(m.width).
		Padding(0, 1).
		Render(status)
}

func (m StateModel) renderHelpView() string {
	helpBox := lipgloss.NewStyle().
		Border(lipgloss.DoubleBorder()).
		BorderForeground(lipgloss.Color("#818CF8")).
		Padding(1, 2).
		Width(60)

	content := `
  Git Graph TUI - Keyboard Shortcuts

  Navigation:
    ↑ / k          Move up in commit list / Scroll diff up
    ↓ / j          Move down in commit list / Scroll diff down
    PgUp / PgDown  Scroll by 10 items or half page
    Tab            Switch focus between Commits & Diff pane

  Filters & Actions:
    o              Open Remote Git Repo (via HTTPS or SSH URL)
    /              Search commits (Subject, Author, Hash)
    h              Toggle only commits on HEAD
    y              Yank / Copy commit hash to clipboard
    r              Reload/Refresh repository data
    f              Git Fetch from all remotes
    ?              Toggle this help dialog
    q, Ctrl+C      Exit application

  Press [Esc], [?], or [q] to close help.
`
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, helpBox.Render(content))
}

func formatDiffContent(rawDiff string) string {
	if rawDiff == "" {
		return "No changes or initial commit."
	}
	lines := strings.Split(rawDiff, "\n")
	var styledLines []string

	for _, line := range lines {
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			styledLines = append(styledLines, diffAddStyle.Render(line))
		} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			styledLines = append(styledLines, diffDelStyle.Render(line))
		} else if strings.HasPrefix(line, "@@") {
			styledLines = append(styledLines, diffHunkStyle.Render(line))
		} else {
			styledLines = append(styledLines, line)
		}
	}

	return strings.Join(styledLines, "\n")
}
