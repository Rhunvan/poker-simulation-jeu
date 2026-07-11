import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SITE_SESSION_COOKIE, verifySiteSessionToken } from '../lib/siteAuth'
import { PokerClient } from './PokerClient'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const cookieStore = await cookies()
  const isAuthorized = await verifySiteSessionToken(cookieStore.get(SITE_SESSION_COOKIE)?.value)
  if (!isAuthorized) {
    redirect('/login?returnTo=/')
  }

  return <PokerClient />
}
