package git

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// IsRemoteURL checks if the input is an HTTP(S) or SSH Git URL.
func IsRemoteURL(input string) bool {
	input = strings.TrimSpace(input)
	if strings.HasPrefix(input, "https://") || strings.HasPrefix(input, "http://") || strings.HasPrefix(input, "git://") {
		return true
	}
	// SSH format like git@github.com:user/repo.git or ssh://git@...
	if strings.HasPrefix(input, "ssh://") {
		return true
	}
	sshRegex := regexp.MustCompile(`^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:.*`)
	return sshRegex.MatchString(input)
}

// EnsureRemoteRepo clones or updates a remote Git repo into ~/.cache/gitgraph/
// using a blobless bare clone for ultra-fast topology download.
func EnsureRemoteRepo(remoteURL string, progressCb func(string)) (*Context, error) {
	cacheBase, err := os.UserCacheDir()
	if err != nil {
		cacheBase = filepath.Join(os.Getenv("HOME"), ".cache")
	}
	gitgraphCache := filepath.Join(cacheBase, "gitgraph", "remotes")
	if err := os.MkdirAll(gitgraphCache, 0755); err != nil {
		return nil, err
	}

	// Create a stable hash directory for this URL
	hasher := sha256.New()
	hasher.Write([]byte(remoteURL))
	hashStr := hex.EncodeToString(hasher.Sum(nil))[:16]

	// Extract a readable repo name
	cleanURL := strings.TrimSuffix(remoteURL, ".git")
	parts := strings.Split(cleanURL, "/")
	repoName := parts[len(parts)-1]
	if repoName == "" && len(parts) > 1 {
		repoName = parts[len(parts)-2]
	}
	repoDir := filepath.Join(gitgraphCache, fmt.Sprintf("%s-%s", repoName, hashStr))

	if fi, err := os.Stat(repoDir); err == nil && fi.IsDir() {
		// Existing cached repo, fetch newest refs
		if progressCb != nil {
			progressCb("Fetching latest commits from remote...")
		}
		cmd := exec.Command("git", "--git-dir", repoDir, "fetch", "--all", "--prune")
		_ = cmd.Run()
	} else {
		// Clone using blobless bare clone (--filter=blob:none --bare)
		// This downloads commit DAG & tree objects instantly without downloading large files
		if progressCb != nil {
			progressCb(fmt.Sprintf("Cloning remote %s...", repoName))
		}
		cmd := exec.Command("git", "clone", "--filter=blob:none", "--bare", remoteURL, repoDir)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("clone failed: %v: %s", err, string(out))
		}
	}

	return &Context{
		RepoPath: repoDir,
		GitDir:   repoDir,
		IsBare:   true,
	}, nil
}
