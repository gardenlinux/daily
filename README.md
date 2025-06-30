# Garden Linux Daily Dashboard

A real-time monitoring dashboard for Garden Linux CI/CD pipeline status, package builds, and workflow runs.

https://gardenlinux.github.io/daily/

## 🌟 Features

- **Real-time Pipeline Status**: Monitor Production Garden Linux workflows
- **Package Monitoring**: Track package builds and identify issues (via daily cronjob)
- **Historical View**: Browse past Garden Linux versions
- **GitHub Authentication**: Support for both Classic and Fine-grained GitHub tokens

## 🚀 Quick Start

### Prerequisites

- **To build or develop locally:**
    - Node.js 16 or higher
    - npm
- **To use or serve the dashboard (e.g., via GitHub Pages or any static web server):**
    - No dependencies required; just serve the static files in the repository (index.html, dist/dashboard.js, style.css, etc.)

## 🛠️ Development & Build Workflow

### Development Mode

- **Watch mode**: `npm run dev`
  Rebuilds the dashboard automatically on file changes. Use this for local development.
- **Serve only**: `npm run serve`
  Serves the static files in the current directory (default: http://localhost:8000).

### Production Build

- **Build for production**:

    ```sh
    NODE_ENV=production npm run build
    ```

    This creates a minified, optimized bundle in `dist/dashboard.js` with source maps for debugging. Console statements are removed in production builds.

- **Build only**: `npm run build`
  (If you do not set `NODE_ENV=production`, the output will not be minified.)

### Output Details

- **Entry Point**: `src/main.js`
- **Output**: `dist/dashboard.js` (with source maps)
- **Format**: IIFE for direct browser inclusion
- **Minification**: Enabled automatically when `NODE_ENV=production`

## 🚀 GitHub Pages Integration

This dashboard is designed to be deployed on GitHub Pages:

- The `dist/` directory contains the production-ready JavaScript bundle.
- The `index.html` and `style.css` are also in the repository root for direct serving.
- GitHub Pages is configured to serve from the `/` (root).
- After building, simply push your changes to the `gh-pages` branch.
- The dashboard will be live at: https://gardenlinux.github.io/daily/

## 🔧 Configuration

### GitHub Token (Optional but Recommended)

To avoid GitHub API rate limits, configure a personal access token:

1. Go to [GitHub Settings > Tokens](https://github.com/settings/tokens)
2. Create a token with `public_repo` or `repo` scope
3. Click the ⚙️ settings button in the dashboard
4. Enter your token and save

The dashboard supports both Classic (`ghp_`) and Fine-grained (`github_pat_`) tokens.
