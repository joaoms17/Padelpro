"use client";

interface Props {
  shotCounts: Record<string, Record<string, number>>;
}

const SHOT_TYPES = ["forehand", "backhand", "volley", "smash", "bandeja", "vibora", "serve", "lob", "other"];
const SHOT_LABELS: Record<string, string> = {
  forehand: "Direita",
  backhand: "Esquerda",
  volley: "Volley",
  smash: "Remate",
  bandeja: "Bandeja",
  vibora: "Víbora",
  serve: "Serviço",
  lob: "Lob",
  other: "Outro",
};

export function ShotBreakdown({ shotCounts }: Props) {
  const players = ["player_1", "player_2", "player_3", "player_4"];

  const rowTotal = (shot: string) =>
    players.reduce((sum, p) => sum + (shotCounts[p]?.[shot] ?? 0), 0);

  const colTotal = (player: string) =>
    SHOT_TYPES.reduce((sum, s) => sum + (shotCounts[player]?.[s] ?? 0), 0);

  const grandTotal = SHOT_TYPES.reduce((sum, s) => sum + rowTotal(s), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-gray-400 font-medium border-b border-gray-700">
              Pancada
            </th>
            {players.map((p, i) => (
              <th
                key={p}
                className="text-center py-2 px-3 text-gray-400 font-medium border-b border-gray-700"
              >
                J{i + 1}
              </th>
            ))}
            <th className="text-center py-2 px-3 text-gray-300 font-semibold border-b border-gray-700">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {SHOT_TYPES.map((shot, idx) => (
            <tr
              key={shot}
              className={idx % 2 === 0 ? "bg-gray-900" : "bg-gray-800/50"}
            >
              <td className="py-2 px-3 text-gray-300 font-medium">
                {SHOT_LABELS[shot]}
              </td>
              {players.map((p) => (
                <td key={p} className="py-2 px-3 text-center text-gray-400">
                  {shotCounts[p]?.[shot] ?? 0}
                </td>
              ))}
              <td className="py-2 px-3 text-center text-white font-semibold">
                {rowTotal(shot)}
              </td>
            </tr>
          ))}
          {/* Totals row */}
          <tr className="border-t border-gray-700 bg-gray-900">
            <td className="py-2 px-3 text-gray-300 font-semibold">Total</td>
            {players.map((p) => (
              <td key={p} className="py-2 px-3 text-center text-white font-semibold">
                {colTotal(p)}
              </td>
            ))}
            <td className="py-2 px-3 text-center text-brand font-bold">
              {grandTotal}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
