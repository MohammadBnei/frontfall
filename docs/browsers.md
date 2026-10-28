# Supported browsers

Frontfall runs in the browser, with nothing to install. This page says which browsers it is built for, why those versions, and what has actually been tried.

## The short version

| Browser                                                | Oldest version              | In CI                                    | Status              |
| ------------------------------------------------------ | --------------------------- | ---------------------------------------- | ------------------- |
| Chrome (desktop and Android)                           | 111                         | Chromium, latest                         | Played              |
| Edge                                                   | 111                         | Through Chromium                         | Hypothesis          |
| Firefox (desktop)                                      | 114 (121 for the full look) | Firefox, latest                          | CI only             |
| Safari on macOS                                        | 16.4                        | WebKit, latest                           | CI only, to confirm |
| Safari on iPhone and iPad, and every other iOS browser | iOS 16.4                    | WebKit (the desktop build of the engine) | CI only, to confirm |
| Samsung Internet                                       | 22                          | No                                       | Hypothesis          |

"In CI" means the end-to-end tests of [`e2e/`](../e2e) play the game in that engine on every change: Chromium, Firefox and WebKit, WebKit being the engine of Safari and of every browser on iOS. CI runs the latest release of each, never the oldest version in the table, so the oldest versions come from the code's needs (below), not from having tried them. "Hypothesis" means we expect it to work because it shares an engine or a build target with a browser we did test, and nobody has checked. "To confirm" means it works in CI's WebKit, which is not the same as a real iPhone: see the list at the end.

Anything older than the table, or a browser that lacks WebGL 2, shows a message saying so instead of a blank page.

## Where the versions come from

The client is built for the targets of Vite's "widely available" baseline (Chrome and Edge 111, Firefox 114, Safari and iOS 16.4), so the code itself does not ask for more. What it needs from the browser, and since when:

| What                           | Used for                                          | Chrome / Edge | Firefox  | Safari   |
| ------------------------------ | ------------------------------------------------- | ------------- | -------- | -------- |
| WebGL 2                        | Drawing the map and the globe                     | 56            | 51       | 15       |
| Web Workers, as modules        | The game's simulation, off the main thread        | 80            | 114      | 15       |
| `fetch`, WebSocket             | Maps, online games                                | long ago      | long ago | long ago |
| `IndexedDB`                    | Resuming an online game after a reload (optional) | long ago      | long ago | long ago |
| `CompressionStream`            | Saving a replay (optional)                        | 80            | 113      | 16.4     |
| CSS `zoom`                     | The interface size setting (optional)             | long ago      | 126      | long ago |
| CSS `:has()`                   | Highlighting the chosen option (cosmetic)         | 105           | 121      | 15.4     |
| `touch-action`, pointer events | Moving and pinching the map by touch              | 36            | 52       | 13       |
| Cookies with `SameSite=Lax`    | Signing in with Discord or Google (optional)      | 51            | 60       | 12       |

Three of these decide the oldest versions: Firefox 114 for module workers, Safari 16.4 for the rest of the build target, and Chrome 111 for the same reason. Two are about looks only. Firefox 114 to 120 draws the selected map card without its highlight, and Firefox before 126 ignores the interface size setting. Both are fixed by updating.

Only WebGL 2 and Web Workers are required: without them the game cannot start, so the page says what is missing. Everything marked optional only costs the feature it serves. Private browsing that blocks storage, for example, forgets your settings but plays normally.

## What the game checks when it starts

- A tiny script, loaded before the game, catches browsers too old to read it at all and shows a short message in English or French.
- Once the game has loaded, it checks for WebGL 2 and workers and, if one is missing, names it in your language at the top of the menu. Watching a replay file or changing settings still works; starting a game says why it cannot.

## What is tried where

- **In CI, on every change**: the solo game, replays, the globe, the narrow-phone interface, accessibility settings, the local profile, achievements and this compatibility message run in Chromium, Firefox (headed under a virtual display, with WebGL forced over software rendering) and WebKit. Touch gestures with two fingers can only be emulated in Chromium, so the pinch test skips the others.
- **Known differences**: on real Safari the second player's amber has been seen slightly off compared with Chromium (not pinned down yet), and the Firefox start-up is sometimes slow in CI.

## Before a release, by hand on Safari

CI's WebKit has no real GPU, no real touch screen and no real address bar, so each release gets a short run on a Mac and an iPhone:

1. The menu loads, in English and in French, and Play solo starts a game with the map drawn.
2. The second player's colour (amber) looks right next to the first.
3. On the iPhone, in portrait and landscape: drag the map, pinch to zoom, tap a tile to attack, open the Build button and place a building. The page itself never scrolls or zooms.
4. Add the game to the home screen: the icon is the Frontfall logo.
5. Turn on Reduce motion and the larger interface size: both are kept after a reload.
6. Start an online game from two tabs or devices, reload one, and it takes its seat back.

## Found a problem on your browser?

Open an issue with the browser, its version and the device, and what you saw. A screenshot of the message at the top of the menu, if there is one, helps.
