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

- Node.js 16 or higher
- npm

### Development Workflow

- **Watch mode**: `npm run dev` - Automatically rebuilds on file changes
- **Build only**: `npm run build` - Creates production bundle
- **Serve only**: `npm run serve` - Serves existing files

### 📦 Build Process

The build process uses [Rollup](https://rollupjs.org/) to bundle the modular JavaScript into a single IIFE (Immediately Invoked Function Expression) file:

1. **Entry Point**: `src/main.js`
2. **Output**: `dist/dashboard.js` (with source maps)
3. **Format**: IIFE for direct browser inclusion
4. **Production**: Minified with dead code elimination

## 🔧 Configuration

### GitHub Token (Optional but Recommended)

To avoid GitHub API rate limits, configure a personal access token:

1. Go to [GitHub Settings > Tokens](https://github.com/settings/tokens)
2. Create a token with `public_repo` or `repo` scope
3. Click the ⚙️ settings button in the dashboard
4. Enter your token and save

The dashboard supports both Classic (`ghp_`) and Fine-grained (`github_pat_`) tokens.

