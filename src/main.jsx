import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import AdminPanel from './admin.jsx'
import './styles.css'

const isAdmin = location.pathname.replace(/\/+$/, '') === '/admin'

createRoot(document.getElementById('root')).render(isAdmin ? <AdminPanel /> : <App />)
