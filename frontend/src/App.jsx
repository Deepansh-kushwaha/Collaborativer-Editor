import './App.css'
import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { Editor } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import * as Y from 'yjs'
import { SocketIOProvider } from 'y-socket.io'

// ── Constants ────────────────────────────────────────────────────────────────

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5000'
const ROOM = 'monaco'

// Curated palette — readable, visually distinct
const CURSOR_COLORS = [
  '#E53935', '#8E24AA', '#1E88E5', '#00897B',
  '#F4511E', '#6D4C41', '#039BE5', '#43A047',
]

function randomColor() {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]
}

// ── Style injection (idempotent) ─────────────────────────────────────────────

const injectedColors = new Set()

function injectCursorStyle(color) {
  if (injectedColors.has(color)) return
  injectedColors.add(color)

  const clean = color.replace('#', '')
  const el = document.createElement('style')
  el.id = `cursor-style-${clean}`
  el.innerHTML = `
    .yjs-cursor-${clean} {
      border-left: 2px solid ${color};
    }
    .yjs-label-${clean} {
      background: ${color};
      color: #fff;
      font-size: 11px;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 3px;
      pointer-events: none;
      user-select: none;
    }
  `
  document.head.appendChild(el)
}

// ── Debounce utility ─────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// ── Main component ───────────────────────────────────────────────────────────

export default function App() {
  const [username, setUsername] = useState(
    () => new URLSearchParams(window.location.search).get('username') ?? ''
  )
  const [inputValue, setInputValue] = useState('')
  const [users, setUsers]           = useState([])
  const [connStatus, setConnStatus] = useState('disconnected') // 'connecting' | 'connected' | 'disconnected'

  const editorRef           = useRef(null)
  const monacoRef           = useRef(null)
  const providerRef         = useRef(null)
  const decorationColRef    = useRef(null)
  const usernameRef         = useRef(username)
  const bindingRef          = useRef(null)

  // Stable doc/text — never recreated for the lifetime of the component
  const ydoc  = useMemo(() => new Y.Doc(), [])
  const yText = useMemo(() => ydoc.getText('monaco'), [ydoc])

  // Keep ref in sync for use inside stable callbacks
  useEffect(() => { usernameRef.current = username }, [username])

  // ── Cursor renderer (stable reference) ────────────────────────────────────

  const renderCursors = useCallback((states) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return

    if (!decorationColRef.current) {
      decorationColRef.current = editor.createDecorationsCollection([])
    }

    const decorations = states
      .filter(s => s.cursor && s.user && s.user.username !== usernameRef.current)
      .map(s => {
        const color = s.user.color
        injectCursorStyle(color)
        const clean = color.replace('#', '')
        const { lineNumber, column } = s.cursor

        return {
          range: new monaco.Range(lineNumber, column, lineNumber, column),
          options: {
            className: `yjs-cursor-${clean}`,
            isWholeLine: false,
            after: {
              content: ` ${s.user.username}`,
              inlineClassName: `yjs-label-${clean}`,
            },
          },
        }
      })

    decorationColRef.current.set(decorations)
  }, []) // no deps — reads everything through refs

  // ── Provider lifecycle ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!username) return

    setConnStatus('connecting')

    const provider = new SocketIOProvider(SOCKET_URL, ROOM, ydoc, {
      autoConnect: true,
    })

    providerRef.current = provider

    provider.awareness.setLocalStateField('user', {
      username,
      color: randomColor(),
    })

    // Connection status
    provider.on('status', ({ status }) => setConnStatus(status))

    // Awareness changes
    const handleAwareness = () => {
      const states = Array.from(provider.awareness.getStates().values())

      // Deduplicate by username in case of reconnects
      const seen = new Set()
      const uniqueUsers = states
        .filter(s => s.user?.username)
        .reduce((acc, s) => {
          if (!seen.has(s.user.username)) {
            seen.add(s.user.username)
            acc.push(s.user)
          }
          return acc
        }, [])

      setUsers(uniqueUsers)
      renderCursors(states)
    }

    provider.awareness.on('change', handleAwareness)

    // Bind Monaco if editor is already mounted
    if (editorRef.current) {
      bindingRef.current = new MonacoBinding(
        yText,
        editorRef.current.getModel(),
        new Set([editorRef.current]),
        provider.awareness
      )
    }

    const handleBeforeUnload = () => {
      provider.awareness.setLocalState(null) // cleanly remove self
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      provider.awareness.off('change', handleAwareness)   // ✅ explicit removal
      window.removeEventListener('beforeunload', handleBeforeUnload)
      bindingRef.current?.destroy()
      bindingRef.current = null
      provider.destroy()
      providerRef.current     = null
      decorationColRef.current = null
      setConnStatus('disconnected')
    }
  }, [username, ydoc, yText, renderCursors])

  // Destroy ydoc on full unmount
  useEffect(() => () => ydoc.destroy(), [ydoc])

  // ── Editor mount ───────────────────────────────────────────────────────────

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current  = editor
    monacoRef.current  = monaco

    // If provider is already ready, bind immediately — no polling needed
    if (providerRef.current) {
      bindingRef.current = new MonacoBinding(
        yText,
        editor.getModel(),
        new Set([editor]),
        providerRef.current.awareness
      )
    }

    // Debounced cursor broadcast — don't flood awareness on every keystroke
    const broadcastCursor = debounce((position) => {
      providerRef.current?.awareness.setLocalStateField('cursor', {
        lineNumber: position.lineNumber,
        column: position.column,
      })
    }, 50)

    editor.onDidChangeCursorPosition(e => broadcastCursor(e.position))
  }, [yText])

  // ── Join handler ───────────────────────────────────────────────────────────

  const handleJoin = useCallback(() => {
    const name = inputValue.trim()
    if (!name) return
    setUsername(name)
    window.history.pushState({}, '', `?username=${name}`)
  }, [inputValue])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleJoin()
  }, [handleJoin])

  // ── Join screen ────────────────────────────────────────────────────────────

  if (!username) {
    return (
      <main className="h-screen bg-gray-950 w-full flex">
        <div className="w-1/2">
          <img
            className="object-cover h-screen w-full"
            src="https://cdn.dribbble.com/userupload/25429490/file/original-673f4c2a3ed862ab0a5c79d6e1d46a55.gif"
            alt="Collaborative editing illustration"
          />
        </div>
        <div className="w-1/2 flex items-center justify-center">
          <div className="flex flex-col gap-4">
            <input
              className="p-4 px-6 border border-white text-white bg-transparent"
              type="text"
              placeholder="Enter your username"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              className="p-4 px-8 bg-amber-100 hover:bg-amber-200 disabled:opacity-40"
              onClick={handleJoin}
              disabled={!inputValue.trim()}
            >
              Join
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  const statusColor = {
    connected:    'bg-green-500',
    connecting:   'bg-yellow-400',
    disconnected: 'bg-red-500',
  }[connStatus] ?? 'bg-gray-400'

  return (
    <main className="bg-gray-950 h-screen w-full p-4 flex gap-4">
      <aside className="w-1/4 bg-amber-50 rounded-lg p-4 flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Collaborative Editor</h1>

        {/* Connection status */}
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="capitalize">{connStatus}</span>
        </div>

        <p className="text-lg">Welcome, {username}</p>

        <h2 className="text-xl mt-4">Online ({users.length})</h2>
        <ul className="flex flex-col gap-1">
          {users.map(user => (
            <li key={user.username} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: user.color }}
              />
              <span>
                {user.username}
                {user.username === username && (
                  <span className="text-gray-400 text-sm"> (You)</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <section className="w-3/4 bg-neutral-800 rounded-lg overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          defaultValue="// write your code here"
          theme="vs-dark"
          onMount={handleMount}
        />
      </section>
    </main>
  )
}