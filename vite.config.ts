import { defineConfig } from 'vite';

// The site is served from https://fidgetrope.github.io/chess/ on GitHub
// Pages, so every built asset URL needs the "/chess/" prefix. Vite also
// rewrites the "/" references inside index.html (the favicon, the module
// script) to match. For local `npm run dev` the base is applied too, so the
// dev URL is http://localhost:5173/chess/.
export default defineConfig({
  base: '/chess/',
});
