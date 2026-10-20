import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useHousehold } from "@/data/household";
import {
  categoryUsage,
  createCategory,
  moveCategoryToGroup,
  removeCategory,
  renameCategory,
  saveGroupLabels,
  swapCategoryOrder,
} from "@/data/categories";
import { GROUP_LABELS, GROUP_ORDER, isProtectedCategory } from "@/lib/categories";
import type { Category, CategoryGroup } from "@/lib/types";

export function Categorias() {
  const navigate = useNavigate();
  const { householdId, categories, groupLabels, reload } = useHousehold();
  const [editing, setEditing] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

      {error && <p className="text-sm text-terracota">{error}</p>}

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
          onSwap={(a, b) => run(() => swapCategoryOrder(a, b))}
          onEdit={setEditing}
        />
      ))}

      <p className="text-xs text-tinta/40 dark:text-creme/40 leading-relaxed">
        🔒 Categorias que a app usa nos cálculos (salário e renda para a base fixa,
        eventos, mesadas): podes reordená-las, mas não mudar o nome nem removê-las.
      </p>

      <EditCategory
        category={editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onRename={(c, name) => run(() => renameCategory(c.id, name))}
        onMove={(c, grp) => run(() => moveCategoryToGroup(categories, c.id, grp))}
        onRemove={(c, target) => run(() => removeCategory(householdId!, c.id, target))}
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
  onSwap,
  onEdit,
}: {
  grp: CategoryGroup;
  label: string;
  items: Category[];
  busy: boolean;
  onRenameGroup: (name: string) => Promise<void>;
  onAdd: (name: string) => Promise<void>;
  onSwap: (a: Category, b: Category) => Promise<void>;
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
                await onRenameGroup(groupName);
                setRenaming(false);
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
          return (
            <div key={c.id} className="flex items-center gap-2 px-4 py-2.5">
              <button
                className="flex-1 min-w-0 text-left text-sm truncate disabled:opacity-100"
                disabled={locked}
                onClick={() => onEdit(c)}
              >
                {locked && <span aria-label="protegida">🔒 </span>}
                {c.name}
              </button>
              <div className="flex shrink-0">
                <button
                  className="w-8 h-8 text-tinta/50 dark:text-creme/50 disabled:opacity-20"
                  aria-label="Subir"
                  disabled={busy || i === 0}
                  onClick={() => onSwap(c, items[i - 1])}
                >
                  ↑
                </button>
                <button
                  className="w-8 h-8 text-tinta/50 dark:text-creme/50 disabled:opacity-20"
                  aria-label="Descer"
                  disabled={busy || i === items.length - 1}
                  onClick={() => onSwap(c, items[i + 1])}
                >
                  ↓
                </button>
                {!locked && (
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
                await onAdd(newName);
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
  onClose,
  onRename,
  onMove,
  onRemove,
}: {
  category: Category | null;
  busy: boolean;
  onClose: () => void;
  onRename: (c: Category, name: string) => Promise<void>;
  onMove: (c: Category, grp: CategoryGroup) => Promise<void>;
  onRemove: (c: Category, targetId: string) => Promise<void>;
}) {
  const { householdId, groupLabels } = useHousehold();
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
  const changed = name.trim() !== category.name || grp !== category.grp;

  async function save() {
    if (!category) return;
    if (name.trim() && name.trim() !== category.name) await onRename(category, name);
    if (grp !== category.grp) await onMove(category, grp);
    onClose();
  }

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
            className="input appearance-none"
            value={grp}
            onChange={(e) => setGrp(e.target.value as CategoryGroup)}
          >
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>
                {groupLabels[g]}
              </option>
            ))}
          </select>
          <p className="text-xs text-tinta/40 dark:text-creme/40 mt-1">
            O separador conta para as métricas: entradas, fixas, variáveis, etc.
          </p>
        </div>
        <button
          className="btn-primary w-full"
          disabled={busy || !changed || !name.trim()}
          onClick={save}
        >
          Guardar
        </button>

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
              <button
                className="btn-ghost w-full text-terracota"
                disabled={busy || !target || target === category.id}
                onClick={async () => {
                  if (!target) return;
                  await onRemove(category, target);
                  onClose();
                }}
              >
                Remover e passar tudo para a categoria escolhida
              </button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
