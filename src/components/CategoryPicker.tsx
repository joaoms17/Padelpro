import { useHousehold } from "@/data/household";
import { GROUP_ORDER } from "@/lib/categories";

export function CategoryPicker({
  value,
  onChange,
  allowNone = true,
  placeholder,
  id,
}: {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  allowNone?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const { categories, groupLabels } = useHousehold();

  return (
    <select
      id={id}
      className="input appearance-none"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {allowNone ? (
        <option value="">Sem categoria</option>
      ) : (
        value == null && (
          <option value="" disabled>
            {placeholder ?? "Escolher categoria…"}
          </option>
        )
      )}
      {GROUP_ORDER.map((grp) => {
        const inGroup = categories.filter((c) => c.grp === grp);
        if (inGroup.length === 0) return null;
        return (
          <optgroup key={grp} label={groupLabels[grp]}>
            {inGroup.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
