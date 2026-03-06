OPENCODE_CHANNEL := env('OPENCODE_CHANNEL', shell('git branch --show-current'))

deps:
  bun install

# Build TUI executable for current platform
tui-build: gui-sidecar
# Install TUI executable to ~/.local/bin/
tui-install: tui-build
  cp packages/desktop/src-tauri/sidecars/opencode-cli-${TAURI_ENV_TARGET_TRIPLE:-x86_64-unknown-linux-gnu} ~/.local/bin/opencode-cli
  ln -sf ~/.local/bin/opencode-cli ~/.local/bin/opencode
  chmod +x ~/.local/bin/opencode-cli

# Build desktop sidecar (includes TUI build)
gui-sidecar: deps
  OPENCODE_CHANNEL="{{OPENCODE_CHANNEL}}" TAURI_ENV_TARGET_TRIPLE=${TAURI_ENV_TARGET_TRIPLE:-x86_64-unknown-linux-gnu} bun run --cwd packages/desktop predev

# Build desktop app binary (no bundle)
gui-build: tui-build
  OPENCODE_CHANNEL="{{OPENCODE_CHANNEL}}" bun run --cwd packages/desktop tauri build --no-bundle


# Install desktop binary to ~/.local/bin/
gui-install: gui-build tui-install
  cp packages/desktop/src-tauri/target/release/OpenCode ~/.local/bin/opencode-desktop
  chmod +x ~/.local/bin/opencode-desktop

# Clean build artifacts
clean:
  rm -rf packages/opencode/dist

# Build both TUI and GUI
build: tui-build gui-build

# Install both TUI and GUI
install: gui-install

# Build and install in one step
install-all: clean build install
