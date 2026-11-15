package model

import "time"

// Ref represents a Git reference (branch, remote, tag, HEAD).
type Ref struct {
	Name          string
	ShortName     string
	Target        string
	Type          string // "branch", "remote", "tag", "head"
	IsCurrentHead bool
	IsHeadRef     bool
}

// Commit represents a single Git commit with its graph layout info.
type Commit struct {
	Hash         string
	ShortHash    string
	Parents      []string
	AuthorName   string
	AuthorEmail  string
	AuthoredAt   time.Time
	Subject      string
	Refs         []Ref
	
	// Graph topological properties
	Row          int
	Column       int
	ColorIndex   int
	GraphPrefix  string
}

// Remote represents a remote repository.
type Remote struct {
	Name string
	URL  string
}

// FileChange represents a changed file in a commit.
type FileChange struct {
	Status string // "M", "A", "D", "R"
	Path   string
}

// CommitDetail contains complete commit information including stats and diff.
type CommitDetail struct {
	Commit      Commit
	Body        string
	Files       []FileChange
	FullDiff    string
}

// RepoInfo represents general repository status.
type RepoInfo struct {
	RepoPath    string
	GitDir      string
	IsBare      bool
	HeadRefName string
	HeadHash    string
	Commits     []*Commit
	Refs        []Ref
	Remotes     []Remote
	CommitCount int
}
