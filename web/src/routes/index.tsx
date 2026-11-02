import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  addMember,
  type Balance,
  type Bill,
  createBill,
  getBalances,
  getBills,
  getErrorMessage,
  getHome,
  type Home,
  payShare,
  type Share,
} from '../api'
import { SetupScreen } from '../components/SetupScreen'
import { formatCents, formatPaidAt, parseDollarsToCents } from '../money'

type HomeSearch = { home?: string }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const home = search.home
    return typeof home === 'string' && home.trim().length > 0 ? { home } : {}
  },
  component: BillSplitterPage,
})

function BillSplitterPage() {
  const { home: homeId } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <AppShell>
      {homeId ? (
        <HomeScreen key={homeId} homeId={homeId} onExit={() => navigate({ to: '/', search: {} })} />
      ) : (
        <SetupScreen onOpenHome={(id) => navigate({ to: '/', search: { home: id } })} />
      )}
    </AppShell>
  )
}

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand__mark" aria-hidden="true" />
          Bill Splitter
        </span>
        <span className="topbar__note">shared living, exact cents</span>
      </header>
      {children}
      <footer className="footer">Every amount is a whole number of cents.</footer>
    </div>
  )
}

type HomeScreenProps = {
  homeId: string
  onExit: () => void
}

function HomeScreen({ homeId, onExit }: HomeScreenProps) {
  const [home, setHome] = useState<Home | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pageError, setPageError] = useState<string | null>(null)

  const [memberName, setMemberName] = useState('')
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')
  const [billBusy, setBillBusy] = useState(false)
  const [billError, setBillError] = useState<string | null>(null)

  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({})

  const requestVersion = useRef(0)
  const paymentKeys = useRef(new Map<string, string>())

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      const version = requestVersion.current + 1
      requestVersion.current = version
      if (mode === 'initial') setStatus('loading')

      try {
        const [homeData, billData, balanceData] = await Promise.all([
          getHome(homeId),
          getBills(homeId),
          getBalances(homeId),
        ])

        if (version !== requestVersion.current) return
        setHome(homeData)
        setBills(billData.bills)
        setBalances(balanceData.balances)
        setPageError(null)
        setStatus('ready')
      } catch (error) {
        if (version !== requestVersion.current) return
        setPageError(getErrorMessage(error))
        if (mode === 'initial') setStatus('error')
      }
    },
    [homeId],
  )

  useEffect(() => {
    void load('initial')
    return () => {
      requestVersion.current += 1
    }
  }, [load])

  const refreshBalances = useCallback(async () => {
    try {
      const data = await getBalances(homeId)
      setBalances(data.balances)
    } catch {
      // The payment itself succeeded. Keep the old figures and let the user refresh.
    }
  }, [homeId])

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = memberName.trim()
    if (!name) {
      setMemberError('Enter a name first.')
      return
    }

    setMemberBusy(true)
    setMemberError(null)
    try {
      await addMember(homeId, name)
      setMemberName('')
      await load('refresh')
    } catch (error) {
      setMemberError(getErrorMessage(error))
    } finally {
      setMemberBusy(false)
    }
  }

  async function handleAddBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = billTitle.trim()
    if (!title) {
      setBillError('Give the bill a title.')
      return
    }

    const totalCents = parseDollarsToCents(billAmount)
    if (totalCents === null) {
      setBillError('Enter an amount above zero, with at most two decimal places.')
      return
    }

    setBillBusy(true)
    setBillError(null)
    try {
      await createBill(homeId, title, totalCents)
      setBillTitle('')
      setBillAmount('')
      await load('refresh')
    } catch (error) {
      setBillError(getErrorMessage(error))
    } finally {
      setBillBusy(false)
    }
  }

  async function handlePay(billId: string, share: Share) {
    if (payingShareId !== null) return

    setPayingShareId(share.id)
    setPaymentErrors((current) => {
      if (!(share.id in current)) return current
      const next = { ...current }
      delete next[share.id]
      return next
    })

    // Reuse the key after a timeout or a 5xx: the server may already have paid the share.
    const key = paymentKeys.current.get(share.id) ?? crypto.randomUUID()
    paymentKeys.current.set(share.id, key)

    try {
      const payment = await payShare(billId, share.id, key)
      paymentKeys.current.delete(share.id)
      setBills((current) =>
        current.map((bill) =>
          bill.id !== billId
            ? bill
            : {
                ...bill,
                shares: bill.shares.map((item) =>
                  item.id === share.id ? { ...item, paidAt: payment.paidAt } : item,
                ),
              },
        ),
      )
      void refreshBalances()
    } catch (error) {
      const message = getErrorMessage(error)
      const code = error instanceof ApiError ? error.status : -1

      // A definitive answer means we can safely start a fresh attempt next time.
      if (code !== 0 && code < 500) paymentKeys.current.delete(share.id)

      setPaymentErrors((current) => ({ ...current, [share.id]: message }))

      // 409 means somebody else paid it first. Reload so the page shows the truth.
      if (code === 409) void load('refresh')
    } finally {
      setPayingShareId(null)
    }
  }

  if (status === 'loading') {
    return (
      <main className="page" aria-busy="true">
        <div className="skeleton skeleton--title" />
        <div className="grid">
          <div className="skeleton skeleton--card" />
          <div className="skeleton skeleton--card" />
        </div>
        <p className="muted" role="status">
          Loading this home…
        </p>
      </main>
    )
  }

  if (status === 'error' || !home) {
    return (
      <main className="page">
        <div className="card card--center">
          <p className="eyebrow">Something went wrong</p>
          <h1>We could not load this home</h1>
          <p className="alert" role="alert">
            {pageError ?? 'The home could not be loaded.'}
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void load('initial')}>
              Try again
            </button>
            <button type="button" className="secondary" onClick={onExit}>
              Choose another home
            </button>
          </div>
        </div>
      </main>
    )
  }

  const totalOutstanding = balances.reduce((total, balance) => total + balance.outstandingCents, 0)
  const canCreateBill = home.members.length > 0

  return (
    <main className="page">
      <header className="home-head">
        <div>
          <button type="button" className="link" onClick={onExit}>
            ← Change home
          </button>
          <p className="eyebrow">Shared home</p>
          <h1>{home.name}</h1>
          <p className="muted">
            {home.members.length === 1 ? '1 member' : `${home.members.length} members`} ·{' '}
            {formatCents(totalOutstanding)} outstanding
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void load('refresh')}
          disabled={status !== 'ready'}
        >
          Refresh
        </button>
      </header>

      {pageError ? (
        <div className="banner" role="alert">
          <span>{pageError}</span>
          <button type="button" className="link" onClick={() => void load('refresh')}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid">
        <div className="column">
          <section className="card">
            <div className="card__head">
              <h2>Balances</h2>
              <span className="pill">{formatCents(totalOutstanding)}</span>
            </div>

            {balances.length === 0 ? (
              <p className="muted">No members yet. Add someone below, then you can split a bill.</p>
            ) : (
              <ul className="balance-list">
                {balances.map((balance) => (
                  <li key={balance.memberId}>
                    <span>{balance.name}</span>
                    <strong className={balance.outstandingCents === 0 ? 'settled' : undefined}>
                      {balance.outstandingCents === 0
                        ? 'Settled'
                        : formatCents(balance.outstandingCents)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form className="card" onSubmit={handleAddMember}>
            <h2>Add a member</h2>
            <p className="muted">Members are split in the order they are added.</p>
            <label htmlFor="member-name">Name</label>
            <div className="row">
              <input
                id="member-name"
                value={memberName}
                onChange={(event) => setMemberName(event.target.value)}
                placeholder="Asha"
                autoComplete="off"
                maxLength={120}
              />
              <button type="submit" className="primary" disabled={memberBusy}>
                {memberBusy ? 'Adding…' : 'Add'}
              </button>
            </div>
            {memberError ? (
              <p className="alert" role="alert">
                {memberError}
              </p>
            ) : null}
          </form>

          <form className="card" onSubmit={handleAddBill}>
            <h2>Add a bill</h2>
            <p className="muted">
              Split between all {home.members.length} members, with leftover cents going to the
              earliest members.
            </p>
            <label htmlFor="bill-title">Title</label>
            <input
              id="bill-title"
              value={billTitle}
              onChange={(event) => setBillTitle(event.target.value)}
              placeholder="Electricity"
              autoComplete="off"
              maxLength={120}
            />
            <label htmlFor="bill-amount">Amount in dollars</label>
            <input
              id="bill-amount"
              value={billAmount}
              onChange={(event) => setBillAmount(event.target.value)}
              placeholder="120.50"
              inputMode="decimal"
              autoComplete="off"
            />
            <button type="submit" className="primary" disabled={billBusy || !canCreateBill}>
              {billBusy ? 'Creating…' : 'Split bill'}
            </button>
            {!canCreateBill ? (
              <p className="muted">Add at least one member before creating a bill.</p>
            ) : null}
            {billError ? (
              <p className="alert" role="alert">
                {billError}
              </p>
            ) : null}
          </form>
        </div>

        <section className="column">
          <div className="section-head">
            <h2>Bills</h2>
            <span className="pill">
              {bills.length === 0 ? 'No bills' : `${bills.length} bills`}
            </span>
          </div>

          {bills.length === 0 ? (
            <div className="card card--empty">
              <h3>Nothing to split yet</h3>
              <p className="muted">
                Add a bill on the left. It will show up here with one share per member.
              </p>
            </div>
          ) : (
            bills.map((bill) => (
              <article className="card bill" key={bill.id}>
                <div className="bill__head">
                  <div>
                    <h3>{bill.title}</h3>
                    <p className="muted">
                      {bill.shares.length === 1 ? '1 share' : `${bill.shares.length} shares`}
                    </p>
                  </div>
                  <strong className="bill__total">{formatCents(bill.totalCents)}</strong>
                </div>

                <ul className="shares">
                  {bill.shares.map((share) => {
                    const paidAt = share.paidAt
                    const isPaying = payingShareId === share.id
                    return (
                      <li className={paidAt ? 'share share--paid' : 'share'} key={share.id}>
                        <div className="share__who">
                          <span>{share.memberName ?? 'Member'}</span>
                          <span className={paidAt ? 'badge badge--paid' : 'badge'}>
                            {paidAt ? `Paid ${formatPaidAt(paidAt)}` : 'Unpaid'}
                          </span>
                        </div>
                        <div className="share__action">
                          <strong>{formatCents(share.amountCents)}</strong>
                          {paidAt ? null : (
                            <button
                              type="button"
                              className="primary primary--small"
                              onClick={() => void handlePay(bill.id, share)}
                              disabled={payingShareId !== null}
                            >
                              {isPaying ? 'Paying…' : 'Pay share'}
                            </button>
                          )}
                        </div>
                        {paymentErrors[share.id] ? (
                          <p className="alert share__error" role="alert">
                            {paymentErrors[share.id]}
                          </p>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  )
}
