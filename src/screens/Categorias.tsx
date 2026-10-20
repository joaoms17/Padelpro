import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useHousehold } from "@/data/household";
import {
  categoryUsage,
  createCategory,
  moveCategoryInGroup,
  removeCategory,
  saveGroupLabels,
  updateCategory,
} from "@/data/categories";
import { canRenameCategory, GROUP_LABELS, GROUP_ORDER, isProtectedCategory } from "@/lib/categories";
import { formatCents } from "@/lib/format";
import type { Category, CategoryGroup } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

export function Categorias() {
  const navigate = useNavigate();
  const { householdId, categories, groupLabels, reload } = useHousehold();
  const [editing, setEditing] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Run a change and reload; true if it worked (the error is shown otherwise). */
  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function edit(c: Category | null) {
    setError(null);
    setEditing(c);
  }

  return (
    <div className="space-y-6">
      <button
        className="text-sm text-tinta/50 dark:text-creme/50"
        onClick={() => navigate("/definicoes")}
      >
        ‹ Definições
      </button>
      <PageHeader
        title="Categorias"
        subtitle="Os separadores e as opções que aparecem ao categorizar um movimento."
      />

      {error && !editing && <p className="text-sm text-terracota">{error}</p>}

      {GROUP_ORDER.map((grp) => (
        <GroupSection
          key={grp}
          grp={grp}
          label={groupLabels[grp]}
          items={categories.filter((c) => c.grp === grp)}
          busy={busy}
          onRenameGroup={(name) =>
            run(() => saveGroupLabels(householdId!, { ...groupLabels, [grp]: name }))
          }
          onAdd={(name) => run(() => createCategory(householdId!, categories, grp, name))}
          onMove={(c, delta) => run(() => moveCategoryInGroup(categories, c, delta))}
          onEdit={edit}
        />
      ))}

      <p className="text-xs text-tinta/40 dark:text-creme/40 leading-relaxed">
        🔒 Categorias que a app usa nos cálculos (salário e renda para a base fixa,
        eventos, mesadas): podes mudar a ordem e o nome (menos o das mesadas), mas
        não o separador nem removê-las.
      </p>

      <EditCategory
        category={editing}
        busy={busy}
        error={error}
        onClose={() => edit(null)}
        onSave={(c, patch) => run(() => updateCategory(categories, c, patch))}
        onRemove={(c, target) => run(() => removeCategory(c.id, target))}
      />
    </div>
  );
}

function GroupSection({
  grp,
  label,
  items,
  busy,
  onRenameGroup,
  onAdd,
  onMove,
  onEdit,
}: {
  grp: CategoryGroup;
  label: string;
  items: Category[];
  busy: boolean;
  onRenameGroup: (name: string) => Promise<boolean>;
  onAdd: (name: string) => Promise<boolean>;
  onMove: (c: Category, delta: -1 | 1) => Promise<boolean>;
  onEdit: (c: Category) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [groupName, setGroupName] = useState(label);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => setGroupName(label), [label]);

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-3">
        {renaming ? (
          <div className="flex-1 flex gap-2">
            <input
              className="input py-1.5"
              value={groupName}
              placeholder={GROUP_LABELS[grp]}
              onChange={(e) => setGroupName(e.target.value)}
              aria-label="Nome do separador"
            />
            <button
              className="text-sm text-petroleo font-medium shrink-0"
              disabled={busy}
              onClick={async () => {
                if (await onRenameGroup(groupName)) setRenaming(false);
              }}
            >
              Guardar
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-tinta/50 dark:text-creme/50">
              {label}
            </h2>
            <button
              className="text-xs text-tinta/50 dark:text-creme/50"
              onClick={() => setRenaming(true)}
            >
              Renomear
            </button>
          </>
        )}
      </div>

      <div className="card divide-y divide-areia/50 dark:divide-white/5">
        {items.map((c, i) => {
          const locked = isProtectedCategory(c);
          const editable = canRenameCategory(c);
          return (
            <div key={c.id} className="flex items-center gap-2 px-4 py-2.5">
              <button
                className="flex-1 min-w-0 text-left text-sm truncate disabled:opacity-100"
                disabled={!editable}
                onClick={() => onEdit(c)}
              >
                {locked && <span aria-label="usada nos cálculos">🔒 </span>}
                {c.name}
              </button>
              <div className="flex shrink-0">
                <button
                  className="w-8 h-8 text-tinta/50 dark:text-creme/50 disabled:opacity-20"
                  aria-label="Subir"
                  disabled={busy || i === 0}
                  onClick={() => onMove(c, -1)}
                >
                  ↑
                </button>
                <button
                  className="w-8 h-8 text-tinta/50 dark:text-creme/50 disabled:opacity-20"
                  aria-label="Descer"
                  disabled={busy || i === items.length - 1}
                  onClick={() => onMove(c, 1)}
                >
                  ↓
                </button>
                {editable && (
                  <button
                    className="text-xs text-petroleo font-medium pl-2"
                    onClick={() => onEdit(c)}
                  >
                    Editar
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {adding ? (
          <div className="flex gap-2 px-4 py-2.5">
            <input
              className="input py-1.5"
              autoFocus
              value={newName}
              placeholder="Nome da nova categoria"
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              className="text-sm text-petroleo font-medium shrink-0"
              disabled={busy || !newName.trim()}
              onClick={async () => {
                if (!(await onAdd(newName))) return;
                setNewName("");
                setAdding(false);
              }}
            >
              Adicionar
            </button>
          </div>
        ) : (
          <button
            className="w-full text-left px-4 py-2.5 text-sm text-petroleo"
            onClick={() => setAdding(true)}
          >
            + Nova categoria
          </button>
        )}
      </div>
    </section>
  );
}

function EditCategory({
  category,
  busy,
  error,
  onClose,
  onSave,
  onRemove,
}: {
  category: Category | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (c: Category, patch: { name: string; grp: CategoryGroup }) => Promise<boolean>;
  onRemove: (c: Category, targetId: string) => Promise<boolean>;
}) {
  const { householdId, groupLabels, categoriesById } = useHousehold();
  const [name, setName] = useState("");
  const [grp, setGrp] = useState<CategoryGroup>("variavel");
  const [removing, setRemoving] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ movements: number; rules: number } | null>(null);

  useEffect(() => {
    setName(category?.name ?? "");
    setGrp(category?.grp ?? "variavel");
    setRemoving(false);
    setTarget(null);
    setUsage(null);
  }, [category]);

  useEffect(() => {
    if (!removing || !category || !householdId) return;
    let active = true;
    categoryUsage(householdId, category.id)
      .then((u) => active && setUsage(u))
      .catch(() => active && setUsage(null));
    return () => {
      active = false;
    };
  }, [removing, category, householdId]);

  if (!category) return null;
  const locked = isProtectedCategory(category);
  const changed = name.trim() !== category.name || grp !== category.grp;
  const budget = category.budget_cents ?? 0;
  const targetCat = target ? categoriesById.get(target) : undefined;

  return (
    <Sheet open={!!category} onClose={onClose} title="Categoria">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="cat-name">Nome</label>
          <input
            id="cat-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="cat-grp">Separador</label>
          <select
            id="cat-grp"
            className="input appearance-none disabled:opacity-60"
            value={grp}
            disabled={locked}
            onChange={(e) => setGrp(e.target.value as CategoryGroup)}
          >
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>
                {groupLabels[g]}
              </option>
            ))}
          </select>
          <p className="text-xs text-tinta/40 dark:text-creme/40 mt-1">
            {locked
              ? "🔒 A app usa esta categoria nos cálculos: fica neste separador."
              : "O separador conta para as métricas: entradas, fixas, variáveis, etc."}
          </p>
        </div>
        <button
          className="btn-primary w-full"
          disabled={busy || !changed || !name.trim()}
          onClick={async () => {
            if (await onSave(category, { name, grp })) onClose();
          }}
        >
          Guardar
        </button>

        {error && <p className="text-sm text-terracota">{error}</p>}

        {!locked && (
          <div className="pt-2 border-t border-areia/50 dark:border-white/5 space-y-3">
            {!removing ? (
              <button className="text-sm text-terracota" onClick={() => setRemoving(true)}>
                Remover esta categoria…
              </button>
            ) : (
              <>
                <p className="text-sm text-tinta/70 dark:text-creme/70">
                  {usage == null
                    ? "A contar…"
                    : `Tem ${usage.movements} movimento${usage.movements === 1 ? "" : "s"} e ${usage.rules} regra${usage.rules === 1 ? "" : "s"}.`}{" "}
                  Para onde passam?
                </p>
                <CategoryPicker value={target} allowNone={false} onChange={setTarget} />
                {budget > 0 && targetCat && targetCat.id !== category.id && (
                  <p className="text-xs text-tinta/50 dark:text-creme/50">
                    {targetCat.grp === category.grp
                      ? `O orçamento (${formatCents(budget)}) junta-se ao de «${targetCat.name}».`
                      : `O orçamento (${formatCents(budget)}) deixa de contar: «${targetCat.name}» está noutro separador.`}
                  </p>
                )}
                <button
                  className="btn-ghost w-full text-terracota"
                  disabled={busy || !target || target === category.id}
                  onClick={async () => {
                    if (target && (await onRemove(category, target))) onClose();
                  }}
                >
                  Remover e passar tudo para a categoria escolhida
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
