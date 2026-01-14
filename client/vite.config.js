const { defineConfig } = require('vite');
const path = require('path');

module.exports = defineConfig({
    root: 'src', // Set root to src where index.html is
    base: './',  // Use relative paths for Electron
    build: {
        outDir: '../dist', // Build output outside of src
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        strictPort: true,
    }
});
