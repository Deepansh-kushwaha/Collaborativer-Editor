import './App.css'
import { React, useRef, useMemo, useState, useEffect } from 'react'
import { Editor } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import * as Y from 'yjs'
import { SocketIOProvider } from 'y-socket.io'

function App() {
  const [username, setUsername] = useState(() => {
    return new URLSearchParams(window.location.search).get('username') || ""
  })
  const editorRef = useRef(null)
  const ydoc = useMemo(() => new Y.Doc(), [])
  const yText = useMemo(() => ydoc.getText('monaco'), [ydoc])
  const [users, setUsers] = useState([])

  const handleMount = (editor) => {
    editorRef.current = editor
    new MonacoBinding(
      yText,
      editorRef.current.getModel(),
      new Set([editorRef.current]),
    )
  }

  const handleJoin = (e) => {
    e.preventDefault()
    const uname = e.target.username.value
    if (uname.trim()) {
      setUsername(uname)
      window.history.pushState({}, "", `?username=${uname}`)
    }
  }

  useEffect(() => {
    console.log(username)
    if (username) {
      const provider = new SocketIOProvider('http://localhost:5000', 'monaco', ydoc, {
        autoConnect: true,
      })
      provider.awareness.setLocalStateField("user", { username })
      provider.awareness.on("change", () => {
        const states = Array.from(provider.awareness.getStates().values())
        console.log(states)
        setUsers(states.filter(state => state.user && state.user.username).map(state => state.user))
      })
      function handleBeforeUnload() {
        provider.awareness.setLocalStateField("users", null)
      }
      window.addEventListener('beforeunload', handleBeforeUnload)

      return () => {
        provider.destroy()
        window.removeEventListener("beforeunload", handleBeforeUnload)
      }
    }
  }, [
    username
  ])

  if (!username) {
    return (
      <main className='h-screen bg-gray-950 w-full flex items-center justify-center'>
        <form onSubmit={handleJoin} className='flex flex-col gap-4'>
          <input className='p-4 px-6 rounded-full border border-white  text-white ' name="username" type="text" placeholder="Enter your username" />
          <button className='p-4 px-8 rounded-lg text-white cursor-pointer bg-blue-700 hover:bg-blue-800 transition-all duration-300 active:scale-95' >Join</button>
        </form>
      </main>
    )
  }
  return (
    <main className="bg-gray-950 h-screen w-full p-4 flex gap-4">
      <aside className="w-1/4 bg-amber-50 rounded-lg">
        <div className='p-4'>
          <h1 className='text-2xl font-bold'>Collaborative Editor</h1>
          <p className='text-lg font-medium'>Welcome {username}</p>
          <div className=' p-4'>
            <h2 className='text-xl font-bold'>Users Online</h2>
            <ul>
              {
                users.map((user, index) => {
                  if  (user.username === username) {
                    return <li key={index}>{user.username} (You)</li>
                  }
                  return <li key={index}>{user.username}</li>
                })
              }
            </ul>
          </div>
        </div>
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


export default App  