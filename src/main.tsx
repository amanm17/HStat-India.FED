import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import { applyLook, readLook } from './lib/look'
import './styles.css'
import './brand.css'
import './refresh.css'
import './aman.css'

/* Before the first paint, so the secret look never flashes the FED one. */
applyLook(readLook())
/* The secret look opens dark (App.tsx); set it now so it never flashes light. */
if (readLook() === 'aman') document.documentElement.dataset.theme = 'dark'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
