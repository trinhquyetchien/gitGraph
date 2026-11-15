package graph

import (
	"gitgraph/internal/model"
)

// AssignColumns computes row, column lanes, and color assignments for commits DAG.
func AssignColumns(commits []*model.Commit) {
	if len(commits) == 0 {
		return
	}

	lanes := make([]string, 0)
	byHash := make(map[string]*model.Commit)

	for row, commit := range commits {
		commit.Row = row
		byHash[commit.Hash] = commit

		// Find existing lane for this commit
		col := -1
		for i, h := range lanes {
			if h == commit.Hash {
				col = i
				break
			}
		}

		// If no lane reserved, find first empty slot or append
		if col == -1 {
			for i, h := range lanes {
				if h == "" {
					col = i
					break
				}
			}
			if col == -1 {
				col = len(lanes)
				lanes = append(lanes, commit.Hash)
			} else {
				lanes[col] = commit.Hash
			}
		}

		commit.Column = col
		commit.ColorIndex = col

		// Release current lane
		lanes[col] = ""

		// Assign parent lanes
		if len(commit.Parents) > 0 {
			firstParent := commit.Parents[0]
			existingCol := -1
			for i, h := range lanes {
				if h == firstParent {
					existingCol = i
					break
				}
			}

			if existingCol == -1 || existingCol == col {
				lanes[col] = firstParent
			}

			// Subsequent parents (merge commits)
			for _, parentHash := range commit.Parents[1:] {
				alreadyReserved := false
				for _, h := range lanes {
					if h == parentHash {
						alreadyReserved = true
						break
					}
				}
				if !alreadyReserved {
					emptyIdx := -1
					for i, h := range lanes {
						if h == "" {
							emptyIdx = i
							break
						}
					}
					if emptyIdx == -1 {
						lanes = append(lanes, parentHash)
					} else {
						lanes[emptyIdx] = parentHash
					}
				}
			}
		}

		// Trim trailing empty lanes
		for len(lanes) > 0 && lanes[len(lanes)-1] == "" {
			lanes = lanes[:len(lanes)-1]
		}
	}
}

// BuildGraphPrefix renders ASCII/Unicode DAG connection symbols for a given commit row.
func BuildGraphPrefix(commit *model.Commit, maxColumns int) string {
	symbols := make([]rune, maxColumns*2+2)
	for i := range symbols {
		symbols[i] = ' '
	}

	// Draw node
	nodePos := commit.Column * 2
	if nodePos < len(symbols) {
		symbols[nodePos] = '●'
	}

	// Connect lines if needed
	return string(symbols)
}
