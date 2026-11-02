import { type FormEvent, useState } from 'react'
import { createHome, getErrorMessage } from '../api'

type Props = {
  onOpenHome: (homeId: string) => void
}

export function SetupScreen({ onOpenHome }: Props) {
  const [name, setName] = useState('')
  const [existingId, setExistingId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the home a name first.')
      return
    }

    setCreating(true)
    setError(null)
    try {
      const home = await createHome(trimmed)
      onOpenHome(home.id)
    } catch (createError) {
      setError(getErrorMessage(createError))
    } finally {
      setCreating(false)
    }
  }

  function handleOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = existingId.trim()
    if (!trimmed) {
      setError('Paste a home id to open it.')
      return
    }
    setError(null)
    onOpenHome(trimmed)
  }

  return (
    <section className="setup">
      <div className="setup__intro">
        <p className="eyebrow">Shared bill splitter</p>
        <h1>Split the rent, the wifi bill, the groceries.</h1>
        <p className="muted">
          Create a home, add the people who live there, and split each bill between them. Every
          amount is stored in whole cents, so the shares always add up exactly.
        </p>
      </div>

      <div className="setup__cards">
        <form className="card" onSubmit={handleCreate}>
          <h2>Create a home</h2>
          <p className="muted">Start fresh and add members after this step.</p>
          <label htmlFor="home-name">Home name</label>
          <input
            id="home-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Flat 4B"
            autoComplete="off"
            maxLength={120}
          />
          <button type="submit" className="primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create home'}
          </button>
        </form>

        <form className="card" onSubmit={handleOpen}>
          <h2>Open an existing home</h2>
          <p className="muted">Already have a home id? Jump straight to its bills.</p>
          <label htmlFor="home-id">Home id</label>
          <input
            id="home-id"
            value={existingId}
            onChange={(event) => setExistingId(event.target.value)}
            placeholder="Paste the id here"
            autoComplete="off"
          />
          <button type="submit" className="secondary">
            Open home
          </button>
        </form>
      </div>

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
