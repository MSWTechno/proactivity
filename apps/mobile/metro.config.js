// Monorepo + pnpm-aware Metro config. pnpm stores packages in a flat
// .pnpm/ directory and uses symlinks to expose them; Metro needs symlink
// resolution enabled to follow those when looking up transitive deps.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Watch the entire workspace so changes in other packages trigger reloads.
config.watchFolders = [workspaceRoot];

// Look for modules in both this app's node_modules and the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Follow pnpm's symlinks into .pnpm/ so transitive deps resolve correctly.
config.resolver.unstable_enableSymlinks = true;

// Allow Metro to walk up the directory tree to find node_modules — required
// when transitive deps live deep inside .pnpm/<pkg>/node_modules/.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
