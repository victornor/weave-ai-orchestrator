/** The small pieces the V2 Knowledge tabs share: a loading skeleton, an empty card and a back link. */
export function Skeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-r4 bg-bg-2" />
      ))}
    </div>
  );
}

export function Empty({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return (
    <div className="v2-card p-4">
      <p className="text-ui font-medium text-text-2">{title}</p>
      <p className="mt-1 text-meta text-text-3">{detail}</p>
    </div>
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onClick} className="text-meta text-text-3 hover:text-text-1">
      ← {label}
    </button>
  );
}
