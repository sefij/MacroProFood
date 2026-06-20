import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app imports the dependency-free optimizer core from ../src/core, which
// lives outside this package. `server.fs.allow` lets the dev server read it.
export default defineConfig({
    plugins: [react()],
    server: {
        fs: {
            allow: ['..']
        }
    }
})
