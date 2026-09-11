export function ThreadHeader({ title }: { title?: string | null }) {
  return (
    <div className="flex-none">
      <div className="relative z-10 -mb-14 min-h-14 rounded-t-3xl bg-linear-to-b from-app-surface from-70% to-transparent p-4 pb-6">
        {title ? (
          <h1 className="max-w-[40ch] truncate font-medium" title={title}>
            {title}
          </h1>
        ) : (
          <div className="h-6" aria-hidden="true" />
        )}
      </div>
    </div>
  )
}
