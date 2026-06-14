/**
 * Consistent page header — every page states clearly WHAT it is for, so the
 * product stops feeling like a pile of disconnected tools.
 */
export function PageHeader({
  title,
  children,
  icon,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: string;
}) {
  return (
    <div className="space-y-2 mb-6">
      <h1 className="text-3xl font-bold text-white flex items-center gap-2">
        {icon && <span aria-hidden>{icon}</span>}
        {title}
      </h1>
      {children && (
        <p className="text-gray-400 max-w-2xl leading-relaxed">{children}</p>
      )}
    </div>
  );
}
