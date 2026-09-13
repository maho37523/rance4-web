# Public static deployment

Run the following from this directory to create the complete public static
site:

```sh
npm ci
./build-wasm.sh
npm run build-public
```

`npm run build-public` reads the local game directories below and creates the
deployable `dist/games/` tree with one manifest per game. The public release
commits this generated tree alongside the static runtime so a deployment can
be rebuilt from its exact source revision. Game data lives in the `games/`
folder beside this checkout (override with `GAMES_DIR` if it lives elsewhere):

- `<repo>/../games/RANCE4`
- `<repo>/../games/RANCE4.1`
- `<repo>/../games/RANCE4.2`

Only root-level game files and `bgm/` are published. System 3 hint disks and
bonus-media directories are excluded so a secondary `ADISK.dat` cannot be
loaded accidentally.

The published server needs no Node API. Deploy the resulting `dist/`
directory as static files. The browser fetches `games/<id>/manifest.json` and
then the selected game's files.
