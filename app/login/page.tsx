import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  sanitizeReturnTo,
  SITE_SESSION_COOKIE,
  verifySiteSessionToken,
} from '../../lib/siteAuth'
import { LoginForm } from './LoginForm'
import './login.css'

export const dynamic = 'force-dynamic'

interface LoginPageProps {
  searchParams: Promise<{ returnTo?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const returnTo = sanitizeReturnTo((await searchParams).returnTo)
  const cookieStore = await cookies()
  if (await verifySiteSessionToken(cookieStore.get(SITE_SESSION_COOKIE)?.value)) {
    redirect(returnTo)
  }

  return (
    <main className="site-login-shell">
      <section className="site-login-card" aria-labelledby="site-login-title">
        <span className="site-login-kicker">Table privée</span>
        <h1 id="site-login-title">Pokernaud</h1>
        <p>Entre le mot de passe partagé pour ouvrir la simulation et les mains GTO enregistrées.</p>
        <LoginForm returnTo={returnTo} />
      </section>
    </main>
  )
}
