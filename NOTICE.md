# Notices and source availability

This distribution combines the Kichikuou on Web shell with WebAssembly builds
of xsystem35-sdl2 and system3-sdl2.

- `shell/` and the original web shell are MIT licensed; see `shell/LICENSE`.
- `xsystem35-sdl2/` and `system3-sdl2/` are GPL-2.0 licensed; their complete
  corresponding source and build inputs are included in this repository.
- Generated WebAssembly modules are built from those sources using
  `build-wasm.sh` and then copied into `dist/`.
- Font and third-party notices remain in the source tree and generated output.

The game data under `dist/games/` is game content, not source code. Its
distribution status is documented by the included free-distribution
declarations. It is not relicensed by this repository.
