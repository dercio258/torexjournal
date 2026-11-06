import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Auto-recuperação caso o navegador tente carregar um chunk antigo após novo deploy
window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    const reloadKey = 'torex_chunk_reload'
    const lastReload = Number(sessionStorage.getItem(reloadKey) || '0')
    if (Date.now() - lastReload > 10000) {
        sessionStorage.setItem(reloadKey, String(Date.now()))
        window.location.reload()
    }
})

const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
        updateSW(true)
    },
    onRegisteredSW(_swUrl, registration) {
        if (registration) {
            registration.update().catch(() => {})
        }
    },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

