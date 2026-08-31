/// <reference types="vite/client" />
// Pulls in Vite's ambient types for `import.meta.env` (used by
// pyodide/config.ts to build the wheel URLs from BASE_URL). Vite scaffolds
// this file by default; this project never had one because nothing touched
// import.meta until now.
