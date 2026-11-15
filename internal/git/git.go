package git

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gitgraph/internal/model"
)

type Context struct {
	RepoPath string
	GitDir   string
	IsBare   bool
}

func ResolveContext(inputPath string) (*Context, error) {
	if IsRemoteURL(inputPath) {
		return EnsureRemoteRepo(inputPath, nil)
	}

	var targetPath string
	if inputPath == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		targetPath = cwd
	} else {
		abs, err := filepath.Abs(inputPath)
		if err != nil {
			return nil, err
		}
		targetPath = abs
	}

	fi, err := os.Stat(targetPath)
	if err != nil {
		return nil, fmt.Errorf("path not found: %s", targetPath)
	}

	// Case 1: Pointing directly to .git
	if filepath.Base(targetPath) == ".git" {
		if fi.IsDir() {
			return &Context{
				RepoPath: filepath.Dir(targetPath),
				GitDir:   targetPath,
				IsBare:   false,
			}, nil
		}
		// .git file (e.g. submodule or worktree)
		pointer, err := resolveGitPointer(targetPath)
		if err != nil {
			return nil, err
		}
		return &Context{
			RepoPath: filepath.Dir(targetPath),
			GitDir:   pointer,
			IsBare:   false,
		}, nil
	}

	if fi.IsDir() {
		dotGit := filepath.Join(targetPath, ".git")
		if dfi, err := os.Stat(dotGit); err == nil {
			if dfi.IsDir() {
				return &Context{
					RepoPath: targetPath,
					GitDir:   dotGit,
					IsBare:   false,
				}, nil
			}
			pointer, err := resolveGitPointer(dotGit)
			if err != nil {
				return nil, err
			}
			return &Context{
				RepoPath: targetPath,
				GitDir:   pointer,
				IsBare:   false,
			}, nil
		}

		// Check if bare repository
		cmd := exec.Command("git", "--git-dir", targetPath, "rev-parse", "--is-bare-repository")
		out, err := cmd.Output()
		if err == nil && strings.TrimSpace(string(out)) == "true" {
			return &Context{
				RepoPath: targetPath,
				GitDir:   targetPath,
				IsBare:   true,
			}, nil
		}
	}

	return nil, fmt.Errorf("not a git repository: %s", targetPath)
}

func resolveGitPointer(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "gitdir:") {
			rel := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
			return filepath.Abs(filepath.Join(filepath.Dir(path), rel))
		}
	}
	return "", fmt.Errorf("invalid gitdir file format in %s", path)
}

func (c *Context) RunGit(args ...string) (string, error) {
	var gitArgs []string
	if c.IsBare {
		gitArgs = append([]string{"--git-dir", c.GitDir}, args...)
	} else {
		gitArgs = append([]string{"--git-dir", c.GitDir, "--work-tree", c.RepoPath}, args...)
	}

	cmd := exec.Command("git", gitArgs...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimRight(stdout.String(), "\r\n"), nil
}

func LoadRepoInfo(ctx *Context) (*model.RepoInfo, error) {
	headRef, _ := ctx.RunGit("symbolic-ref", "--quiet", "HEAD")
	headHash, _ := ctx.RunGit("rev-parse", "HEAD")

	rawRefs, _ := ctx.RunGit("for-each-ref",
		"--format=%(refname)\t%(objectname)\t%(*objectname)\t%(HEAD)",
		"refs/heads", "refs/remotes", "refs/tags",
	)
	refs := parseRefs(rawRefs, headRef, headHash)

	refsByTarget := make(map[string][]model.Ref)
	for _, r := range refs {
		refsByTarget[r.Target] = append(refsByTarget[r.Target], r)
	}

	remotes := loadRemotes(ctx)

	countStr, _ := ctx.RunGit("rev-list", "--all", "--count")
	commitCount, _ := strconv.Atoi(strings.TrimSpace(countStr))

	var commits []*model.Commit
	if commitCount > 0 {
		rawLog, err := ctx.RunGit("log", "--graph", "--all", "--date-order", "--format=COMMIT_START%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s")
		if err == nil {
			commits = parseCommitsWithGraph(rawLog, refsByTarget)
		}
	}

	return &model.RepoInfo{
		RepoPath:    ctx.RepoPath,
		GitDir:      ctx.GitDir,
		IsBare:      ctx.IsBare,
		HeadRefName: headRef,
		HeadHash:    headHash,
		Commits:     commits,
		Refs:        refs,
		Remotes:     remotes,
		CommitCount: len(commits),
	}, nil
}

func parseRefs(rawRefs, headRef, detachedHeadHash string) []model.Ref {
	var refs []model.Ref
	lines := strings.Split(rawRefs, "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}
		refName := parts[0]
		objName := parts[1]
		target := objName
		if len(parts) >= 3 && parts[2] != "" {
			target = parts[2]
		}
		isCurrentHead := len(parts) >= 4 && parts[3] == "*"

		refType := "ref"
		if strings.HasPrefix(refName, "refs/heads/") {
			refType = "branch"
		} else if strings.HasPrefix(refName, "refs/remotes/") {
			refType = "remote"
		} else if strings.HasPrefix(refName, "refs/tags/") {
			refType = "tag"
		}

		short := refName
		short = strings.TrimPrefix(short, "refs/heads/")
		short = strings.TrimPrefix(short, "refs/remotes/")
		short = strings.TrimPrefix(short, "refs/tags/")

		refs = append(refs, model.Ref{
			Name:          refName,
			ShortName:     short,
			Target:        target,
			Type:          refType,
			IsCurrentHead: isCurrentHead,
			IsHeadRef:     refName == headRef,
		})
	}

	if headRef == "" && detachedHeadHash != "" {
		refs = append(refs, model.Ref{
			Name:          "HEAD",
			ShortName:     "HEAD",
			Target:        detachedHeadHash,
			Type:          "head",
			IsCurrentHead: true,
			IsHeadRef:     true,
		})
	}

	return refs
}

func parseCommitsWithGraph(rawLog string, refsByTarget map[string][]model.Ref) []*model.Commit {
	var commits []*model.Commit
	lines := strings.Split(rawLog, "\n")
	var pendingGraphLines []string

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}

		if idx := strings.Index(line, "COMMIT_START"); idx != -1 {
			prefix := line[:idx]
			if len(pendingGraphLines) > 0 {
				prefix = strings.Join(pendingGraphLines, "\n") + "\n" + prefix
				pendingGraphLines = nil
			}

			payload := line[idx+len("COMMIT_START"):]
			parts := strings.Split(payload, "\u001f")
			if len(parts) < 6 {
				continue
			}

			hash := parts[0]
			shortHash := hash
			if len(shortHash) > 8 {
				shortHash = shortHash[:8]
			}
			parentsRaw := parts[1]
			var parents []string
			if parentsRaw != "" {
				for _, p := range strings.Split(parentsRaw, " ") {
					if p != "" {
						parents = append(parents, p)
					}
				}
			}
			authorName := parts[2]
			authorEmail := parts[3]
			authoredAt, _ := time.Parse(time.RFC3339, parts[4])
			subject := parts[5]

			commits = append(commits, &model.Commit{
				Hash:        hash,
				ShortHash:   shortHash,
				Parents:     parents,
				AuthorName:  authorName,
				AuthorEmail: authorEmail,
				AuthoredAt:  authoredAt,
				Subject:     subject,
				Refs:        refsByTarget[hash],
				GraphPrefix: prefix,
			})
		} else {
			// Lines between commits (e.g. branch merges or splits like "|/  " or "| \ ")
			pendingGraphLines = append(pendingGraphLines, line)
		}
	}
	return commits
}

func loadRemotes(ctx *Context) []model.Remote {
	out, err := ctx.RunGit("remote", "-v")
	if err != nil || out == "" {
		return nil
	}
	seen := make(map[string]bool)
	var remotes []model.Remote
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Fields(line)
		if len(parts) >= 2 && !seen[parts[0]] {
			seen[parts[0]] = true
			remotes = append(remotes, model.Remote{
				Name: parts[0],
				URL:  parts[1],
			})
		}
	}
	return remotes
}

func FetchRemotes(ctx *Context) error {
	_, err := ctx.RunGit("fetch", "--all", "--prune")
	return err
}

func LoadCommitDetail(ctx *Context, commit *model.Commit) (*model.CommitDetail, error) {
	body, _ := ctx.RunGit("log", "-1", "--pretty=format:%B", commit.Hash)

	// Changed files with status
	rawFiles, _ := ctx.RunGit("show", "--name-status", "--pretty=format:", commit.Hash)
	var files []model.FileChange
	for _, line := range strings.Split(rawFiles, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) >= 2 {
			files = append(files, model.FileChange{
				Status: parts[0],
				Path:   parts[1],
			})
		}
	}

	// Full commit diff
	diff, _ := ctx.RunGit("show", "--patch", "--stat", commit.Hash)

	return &model.CommitDetail{
		Commit:   *commit,
		Body:     body,
		Files:    files,
		FullDiff: diff,
	}, nil
}
