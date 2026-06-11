import { cn, STATUS_COLOURS } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLOURS[status] ?? "bg-gray-100 text-gray-600")}>
      {status}
    </span>
  );
}
