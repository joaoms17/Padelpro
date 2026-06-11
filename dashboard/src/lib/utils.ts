import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export const STROKE_LABELS: Record<string, string> = {
  forehand_volley: "Volley Dir",
  backhand_volley: "Volley Esq",
  bandeja: "Bandeja",
  vibora: "Víbora",
  smash: "Smash",
  serve: "Serviço",
  other: "Outro",
};

export const ZONE_LABELS: Record<string, string> = {
  net_left: "Rede Esq",
  net_right: "Rede Dir",
  mid_left: "Centro Esq",
  mid_right: "Centro Dir",
  back_left: "Fundo Esq",
  back_right: "Fundo Dir",
};

export const STATUS_COLOURS: Record<string, string> = {
  queued:      "bg-gray-100 text-gray-700",
  segmenting:  "bg-yellow-100 text-yellow-700",
  processing:  "bg-blue-100 text-blue-700",
  done:        "bg-green-100 text-green-700",
  error:       "bg-red-100 text-red-700",
};
