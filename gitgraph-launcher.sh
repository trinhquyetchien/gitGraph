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

# Detect terminal emulator
if command -v gnome-terminal >/dev/null 2>&1; then
  exec gnome-terminal --title="Git Graph" -- "$HOME/.local/bin/gitgraph" "$TARGET_DIR"
elif command -v wezterm >/dev/null 2>&1; then
  exec wezterm start --title "Git Graph" "$HOME/.local/bin/gitgraph" "$TARGET_DIR"
elif command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator -T "Git Graph" -e "$HOME/.local/bin/gitgraph" "$TARGET_DIR"
else
  exec "$HOME/.local/bin/gitgraph" "$TARGET_DIR"
fi
