#!/usr/bin/env bash
# Git Graph Launcher script

TARGET_DIR="$1"

# If no target repo is passed and current directory is not a git repo, prompt the user
if [ -z "$TARGET_DIR" ]; then
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if command -v zenity >/dev/null 2>&1; then
      CHOICE=$(zenity --list \
        --title="Git Graph - Mở Repository" \
        --text="Bạn muốn mở Git Repository bằng cách nào?" \
        --radiolist \
        --column="Chọn" --column="Phương thức" --column="Mô tả" \
        TRUE "local" "Chọn thư mục Git trên máy tính (Local)" \
        FALSE "remote" "Nhập đường dẫn từ xa (HTTPS / SSH URL)" \
        --width=520 --height=260 \
        --ok-label="Tiếp tục" --cancel-label="Hủy")

      if [ $? -ne 0 ] || [ -z "$CHOICE" ]; then
        exit 0
      fi

      if [ "$CHOICE" = "local" ]; then
        TARGET_DIR=$(zenity --file-selection --directory --title="Chọn thư mục Git Repository (Local)")
        if [ $? -ne 0 ] || [ -z "$TARGET_DIR" ]; then
          exit 0
        fi
      elif [ "$CHOICE" = "remote" ]; then
        TARGET_DIR=$(zenity --entry \
          --title="Git Graph - Mở Remote Repository" \
          --text="Nhập link HTTPS hoặc SSH của repository:\n(Ví dụ: https://github.com/charmbracelet/bubbletea.git)" \
          --width=550 \
          --ok-label="Mở Repository" --cancel-label="Hủy")
        if [ $? -ne 0 ] || [ -z "$TARGET_DIR" ]; then
          exit 0
        fi
      fi
    fi
  fi
fi

# Try launching in terminal using user's shell zsh
launch_app() {
  # 1. First try wezterm start if functioning
  if command -v wezterm >/dev/null 2>&1; then
    wezterm start -- "$HOME/.local/bin/gitgraph" "$TARGET_DIR" 2>/dev/null && return 0
  fi

  # 2. Try gnome-terminal with zsh
  if command -v gnome-terminal >/dev/null 2>&1; then
    exec gnome-terminal --title="Git Graph" -- /bin/zsh -c "\"$HOME/.local/bin/gitgraph\" \"$TARGET_DIR\""
    return 0
  fi

  # 3. Fallback to system terminal
  if command -v x-terminal-emulator >/dev/null 2>&1; then
    exec x-terminal-emulator -T "Git Graph" -e /bin/zsh -c "\"$HOME/.local/bin/gitgraph\" \"$TARGET_DIR\""
    return 0
  fi

  exec "$HOME/.local/bin/gitgraph" "$TARGET_DIR"
}

launch_app
