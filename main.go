package main

import (
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"gitgraph/internal/ui"
)

func main() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: gitgraph [path to repository or .git]\n\n")
		fmt.Fprintf(os.Stderr, "A powerful Git DAG & commit viewer for the Linux terminal.\n\n")
		flag.PrintDefaults()
	}

	flag.Parse()

	repoPath := ""
	if flag.NArg() > 0 {
		repoPath = flag.Arg(0)
	}

	model, err := ui.InitialModel(repoPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	p := tea.NewProgram(model, tea.WithAltScreen(), tea.WithMouseCellMotion())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start program: %v\n", err)
		os.Exit(1)
	}
}
