export const dynamic = 'force-dynamic'

// Stripe redirects here if the buyer backs out before paying. No charge was made.
export default async function RegisterCancel({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event } = await searchParams
  const back = event ? `/register?event=${encodeURIComponent(event)}` : '/register'
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111] p-6 text-center shadow-xl">
        <h1 className="text-lg font-semibold text-white">Payment cancelled</h1>
        <p className="mt-2 text-sm text-zinc-400">No charge was made.</p>
        <a href={back} className="mt-4 inline-block bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl px-5 py-2.5 text-sm">
          Try again
        </a>
      </div>
    </div>
  )
}
