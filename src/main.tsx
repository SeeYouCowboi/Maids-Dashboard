import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './query/client'
import { AuthProvider } from './auth/AuthProvider'
import { AuthGuard } from './auth/AuthGuard'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGuard>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthGuard>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
