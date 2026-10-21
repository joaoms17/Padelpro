import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/ui";
import { Chip, Loading, Segmented } from "@/components/kit";
import { MonthReport, type ReportMode } from "@/components/MonthReport";
import { MonthCompare } from "@/components/MonthCompare";
import { useHousehold } from "@/data/household";
import { useEngineData } from "@/data/engine";
import { buildMonthsView } from "@/lib/view";
import { monthChips } from "@/lib/meses";

/** Each month, closed: what came in, where it went, what was left. And the months side by side. */
export function Meses() {
  const { householdId } = useHousehold();
  const { data, loading, error, reload } = useEngineData(householdId);
  const { mes } = useParams();
  const navigate = useNavigate();
  const view = useMemo(() => (data ? buildMonthsView(data) : null), [data]);
  const [mode, setMode] = useState<ReportMode>("real");
  const [semPontuais, setSemPontuais] = useState(false);
  const chipsRef = useRef<HTMLDivElement>(null);

  const comparar = mes === "comparar";
  const month = view ? (mes && view.months.includes(mes) ? mes : (view.lastClosed ?? view.current)) : null;

  // Keep the chosen chip in sight when the row scrolls (many months).
  useEffect(() => {
    const row = chipsRef.current;
    const active = row?.querySelector<HTMLElement>("[data-active='true']");
    if (row && active) row.scrollLeft = Math.max(0, active.offsetLeft - row.clientWidth / 2 + active.clientWidth / 2);
  }, [month, comparar, view]);

  const header = (
    <div className="pr-12">
      <PageHeader title="Meses" subtitle="O que entrou, para onde foi e quanto sobrou." />
    </div>
  );

  if (!data || !view || !month) {
    return (
      <div className="space-y-4">
        {header}
        <Loading error={loading ? null : error} />
      </div>
    );
  }

  const chips = monthChips(view.months, view.real, view.current);
  const real = view.real.get(month)!;
  const hasPontuais = real.pontualIn + real.pontualOut > 0;

  return (
    <div className="space-y-5">
      {header}

      <div ref={chipsRef} className="flex gap-2 overflow-x-auto pb-1 min-w-0">
        {chips.map((c) => (
          <span key={c.month} data-active={!comparar && c.month === month} className="shrink-0">
            <Chip active={!comparar && c.month === month} onClick={() => navigate(`/meses/${c.month}`)}>
              {c.label}
            </Chip>
          </span>
        ))}
        <span data-active={comparar} className="shrink-0">
          <Chip active={comparar} onClick={() => navigate("/meses/comparar")}>
            Comparar
          </Chip>
        </span>
      </div>

      {error && <p className="text-sm text-terracota">Não consegui atualizar: {error}</p>}

      {comparar ? (
        <MonthCompare view={view} members={data.members} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              options={[
                { value: "real", label: "Real" },
                { value: "modelo", label: "Com o modelo" },
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === "real" && hasPontuais && (
              <Chip active={semPontuais} onClick={() => setSemPontuais((s) => !s)}>
                {semPontuais ? "✓ " : ""}Sem pontuais
              </Chip>
            )}
          </div>
          <MonthReport
            data={data}
            view={view}
            month={month}
            mode={mode}
            semPontuais={mode === "real" && hasPontuais && semPontuais}
            reload={reload}
          />
        </>
      )}
    </div>
  );
}
