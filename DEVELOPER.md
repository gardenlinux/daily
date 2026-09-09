# Developer Guide

## Prerequisites

- Node.js 16 or higher
- npm

## Development and build workflow

### Development mode

Run the following command to rebuild the dashboard automatically on file changes:

```sh
npm run dev
```

To serve the static files without rebuilding (default: `http://localhost:8000`):

```sh
npm run serve
```

### Production build

Build a minified, optimized bundle in `dist/dashboard.js` with source maps:

```sh
NODE_ENV=production npm run build
```

Without `NODE_ENV=production`, the output is not minified:

```sh
npm run build
```

### Output details

| Item         | Value                                  |
| ------------ | -------------------------------------- |
| Entry point  | `src/main.js`                          |
| Output       | `dist/dashboard.js` (with source maps) |
| Format       | IIFE (for direct browser inclusion)    |
| Minification | Enabled when `NODE_ENV=production`     |

## Local serving with branch data

The dashboard reads data from the `packages` and `historic-releases` branches.
To serve the dashboard locally with real data, fetch the branch data first, then start the server:

```sh
npm run packages   # fetches packages/ from the packages branch
npm run historic   # fetches historic/ from the historic-releases branch
npm run serve      # serves at http://localhost:8000
```

To build and serve in one step:

```sh
npm run start
```

## Linting

Check JavaScript (ESLint) and formatting (Prettier):

```sh
npm run lint
```

Auto-fix issues:

```sh
npm run fix
```

## GitHub Pages deployment

The dashboard is served from the `gh-pages` branch via GitHub Pages at
<https://gardenlinux.github.io/daily/>.

After building, push your changes to the `gh-pages` branch:

- `dist/` — production JavaScript bundle
- `index.html` — dashboard entry point
- `style.css` — styles

GitHub Pages is configured to serve from the repository root (`/`).

## GitHub token (optional)

To avoid the GitHub API rate limit of 60 unauthenticated requests per hour,
configure a personal access token in the dashboard:

1. Go to [GitHub Settings > Tokens](https://github.com/settings/tokens).
1. Create a token with `public_repo` scope (Classic `ghp_`) or a Fine-grained token (`github_pat_`).
1. Click the settings icon in the dashboard header.
1. Enter your token and save. The token is stored only in your browser's `localStorage`.
