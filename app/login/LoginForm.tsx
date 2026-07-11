'use client'

import { useState, type FormEvent } from 'react'

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setError(payload?.error ?? 'Accès refusé.')
        return
      }
      window.location.replace(returnTo)
    } catch {
      setError('Connexion impossible pour le moment.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="site-login-form" onSubmit={handleSubmit}>
      <label htmlFor="site-password">Mot de passe</label>
      <input
        id="site-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoFocus
        required
      />
      {error ? <p className="site-login-error" role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Ouverture…' : 'Ouvrir la table'}
      </button>
    </form>
  )
}
