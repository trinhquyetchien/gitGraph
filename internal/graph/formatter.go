package graph

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Vibrant high-contrast multi-lane colors for branch visualization
var LaneColors = []lipgloss.Color{
	lipgloss.Color("#00F0FF"), // Neon Cyan
	lipgloss.Color("#FF2A85"), // Electric Pink
	lipgloss.Color("#FFB800"), // Warm Gold
	lipgloss.Color("#00FF85"), // Bright Mint
	lipgloss.Color("#BD00FF"), // Royal Violet
	lipgloss.Color("#3B82F6"), // Sapphire Blue
	lipgloss.Color("#FF6B00"), // Radiant Orange
	lipgloss.Color("#00E5FF"), // Vivid Turquoise
	lipgloss.Color("#F43F5E"), // Rose Red
	lipgloss.Color("#84CC16"), // Lime Green
}

// FormatGraphPrefix converts raw git graph symbols into thick, high-contrast, bold unicode lines.
func FormatGraphPrefix(rawPrefix string) string {
	if rawPrefix == "" {
		return ""
	}

	var sb strings.Builder
	runes := []rune(rawPrefix)
	n := len(runes)

	for i := 0; i < n; i++ {
		r := runes[i]
		lane := (i / 2) % len(LaneColors)
		color := LaneColors[lane]
		st := lipgloss.NewStyle().Foreground(color).Bold(true)

		switch r {
		case '*':
			// Bullseye heavy commit node with prominent inner ring for clear visibility
			sb.WriteString(lipgloss.NewStyle().Foreground(color).Bold(true).Render("⦿ "))
		case '|':
			// Extra thick vertical line
			sb.WriteString(st.Render("┃ "))
		case '/':
			// Bold diagonal branch line
			sb.WriteString(st.Render("╱ "))
		case '\\':
			// Bold diagonal branch line
			sb.WriteString(st.Render("╲ "))
		case '_':
			sb.WriteString(st.Render("━━"))
		case '-':
			sb.WriteString(st.Render("━━"))
		case ' ':
			sb.WriteString("  ")
		default:
			sb.WriteRune(r)
		}
	}

	return sb.String()
}
