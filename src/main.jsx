import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import AdminPanel from './admin.jsx'
import './styles.css'

const isAdmin = location.pathname.replace(/\/+$/, '') === '/admin'

createRoot(document.getElementById('root')).render(isAdmin ? <AdminPanel /> : <App />)

// 离线壳只在生产构建注册，避免干扰开发态热更新
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
