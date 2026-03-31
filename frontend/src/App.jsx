import React from 'react'
import './App.css'

function App() {
  return (
    <main className="bg-gray-950 h-screen w-full p-2 flex gap-4">
        <aside className="w-1/4 bg-amber-50 rounded-sm">
            sidebar
        </aside>
        <section className="w-3/4 bg-neutral-800 rounded-sm">
            editor
        </section>
    </main>
  )
}

export default App  