# 兰斯 4 系列网页版

统一的静态网页入口，包含《兰斯 4－教团的遗产－》《兰斯 4.1 ～拯救制药厂！～》和《兰斯 4.2 ～天使组～》。运行时使用 WebAssembly：兰斯 4 使用 `xsystem35`，4.1 与 4.2 使用 `system3`。

生产站点只需要静态文件：浏览器会从 `dist/games/<game>/manifest.json` 和同目录的资源启动游戏，不需要 Node.js 服务或用户的本机路径。

移动设备建议横屏游玩；触控层采用方向键、明确的确认/取消键和需手动确认的光标模式，避免把手势误触传入原游戏。

## Building the site

To build the site, you will need to have the following software installed:

- [Node.js](https://nodejs.org)
- [Emscripten](https://emscripten.org/)
- [CMake](https://cmake.org/)

First, clone the repository and install the dependencies:

```sh
git clone --recurse-submodules <your-repository-url>
cd app
npm install
```

Then, build the WebAssembly modules:

```sh
./build-wasm.sh
```

Then create the deployable static site. This also imports the three local game
directories listed in [PUBLIC_DEPLOYMENT.md](PUBLIC_DEPLOYMENT.md):

```sh
npm run build-public
```

The complete site is in `dist`. You can serve it locally with:

```sh
npm run local
```

`dist/games/` is intentionally excluded from Git: it is a deployable game-data
artifact generated from the local source directories. The public deployment
archive includes it. See [PUBLIC_DEPLOYMENT.md](PUBLIC_DEPLOYMENT.md) for the
release procedure and [NOTICE.md](NOTICE.md) for the distribution notice.

## Licenses
Code in the `shell/` and `fslib/` directories is licensed under the
[MIT License](shell/LICENSE).

The [xsystem35-sdl2] submodule is licensed under
[GPL 2.0](https://github.com/kichikuou/xsystem35-sdl2/blob/master/COPYING).

The [system3-sdl2] submodule is licensed under
[GPL 2.0](https://github.com/kichikuou/system3-sdl2/blob/master/COPYING).

The fonts in `dist/fonts/` are copied from the [xsystem35-sdl2] submodule at
build time.

`MTLc3m.ttf` is the "モトヤLシーダ3等幅" font from the Android Open Source
Project and is licensed under the
[Apache License 2.0](https://github.com/kichikuou/xsystem35-sdl2/blob/master/licenses/MTLc3m.txt).

`mincho.ttf` is a subset of the [IPA Mincho](https://moji.or.jp/ipafont/) font and is licensed under the
[IPA Font License v1.0](https://github.com/kichikuou/xsystem35-sdl2/blob/master/licenses/mincho.txt).
The script used for subsetting can be found in
[xsystem35-sdl2/fonts](https://github.com/kichikuou/xsystem35-sdl2/blob/master/fonts/CMakeLists.txt).

This site also uses the following open-source software:

- [Font Awesome](https://fontawesome.com/v4.7.0/) by Dave Gandy ([License](https://fontawesome.com/v4.7.0/license/))
- [Spectre.css](https://picturepan2.github.io/spectre/) by Yan Zhu ([License](https://github.com/picturepan2/spectre/blob/v0.5.8/LICENSE))
- [spessasynth_lib](https://github.com/spessasus/spessasynth_lib) by Spessasus ([License](https://github.com/spessasus/spessasynth_lib/blob/v4.0.0/LICENSE))
- [GeneralUser GS](https://www.schristiancollins.com/generaluser) by S. Christian Collins ([License](https://github.com/mrbumpy409/GeneralUser-GS/blob/d0fc360abafa736f11a1fa18c721f65bfc3a6991/documentation/LICENSE.txt))
- [stbvorbis.js](https://github.com/hajimehoshi/stbvorbis.js) ([License](https://github.com/hajimehoshi/stbvorbis.js/blob/v0.2.2/LICENSE))

[system3-sdl2]: https://github.com/kichikuou/system3-sdl2
[xsystem35-sdl2]: https://github.com/kichikuou/xsystem35-sdl2
