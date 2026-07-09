import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, X } from 'lucide-react'

const ToastContext = createContext(null)
const AUTO_DISMISS_MS = 5000

let nextId = 0

/* custom: shadcn has no toast primitive — hand-rolled, styled with .toast* classes in style.css */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const push = useCallback((message, variant) => {
    const id = ++nextId
    setToasts((ts) => [...ts, { id, message, variant }])
    timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS))
  }, [dismiss])

  const api = useRef({
    error:   (message) => push(message, 'error'),
    success: (message) => push(message, 'success'),
  }).current

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}`} role={t.variant === 'error' ? 'alert' : 'status'}>
            {t.variant === 'error'
              ? <CircleAlert size={16} className="toast-icon" aria-hidden="true" />
              : <CircleCheck size={16} className="toast-icon" aria-hidden="true" />}
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
