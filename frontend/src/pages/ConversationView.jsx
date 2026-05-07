// Placeholder — Phase 3 work for DEV-A.
export default function ConversationView() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <aside className="w-64 border-r border-neutral-200 bg-white p-4">
        {/* DEV-A: BranchSidebar */}
        <p className="text-sm text-neutral-500">BranchSidebar</p>
      </aside>
      <section className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          {/* DEV-A: MessageThread */}
          <p className="text-sm text-neutral-500">MessageThread</p>
          {/* DEV-B: PinsPanel toggle */}
        </div>
        <div className="border-t border-neutral-200 bg-white p-4">
          {/* DEV-A: SendBox */}
          <p className="text-sm text-neutral-500">SendBox</p>
        </div>
      </section>
    </div>
  )
}
