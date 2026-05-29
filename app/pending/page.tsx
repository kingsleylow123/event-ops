import { createSupabaseServerClient } from '@/lib/supabase-server'
import SignOutButton from '../SignOutButton'

export default async function PendingPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#111] border border-zinc-800 rounded-xl p-6 text-center">
        <h1 className="text-xl font-bold mb-2 text-amber-400">Awaiting approval</h1>
        <p className="text-sm text-zinc-400 mb-4">
          Your account <span className="text-white">{user?.email}</span> has been created but still needs to be approved by an administrator.
        </p>
        <p className="text-xs text-zinc-500 mb-6">
          Once an admin approves your request, refresh this page or sign back in.
        </p>
        <SignOutButton />
      </div>
    </div>
  )
}
