import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled from node_modules, not linked from a CDN. A render-blocking
// request to a font host is a third-party runtime dependency: it leaks visitor
// IPs to that host, fails closed on any network that blocks it, and delays first
// paint. Self-hosting also keeps the E2E run fully offline.
//
// The variable Inter file covers the whole 400-700 range in one request and is
// unicode-range gated, so a browser only downloads the subsets it needs. Space
// Grotesk is loaded latin-only, at the three weights the display face uses.
import '@fontsource-variable/inter'
// Fraunces: the display serif for page titles and hero figures. The
// optical-size axis lets large titles draw with finer contrast than small ones.
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import { App } from '@/app/App'
import '@/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)