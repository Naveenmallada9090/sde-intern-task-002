export type AppEnv = { Bindings: Env }

export type HomeRow = {
  id: string
  name: string
}

export type MemberRow = {
  id: string
  homeId: string
  name: string
  position: number
}

export type BillRow = {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt: string
}

export type ShareRow = {
  id: string
  billId: string
  memberId: string
  amountCents: number
  position: number
  paidAt: string | null
  paymentKey: string | null
}

export type BalanceRow = {
  memberId: string
  name: string
  outstandingCents: number
}
