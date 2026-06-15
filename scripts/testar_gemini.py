"""Testar o Gemini localmente num vídeo. Lê GEMINI_API_KEY do ficheiro .env.

Uso:
    .venv\\Scripts\\python.exe scripts\\testar_gemini.py ["caminho do video"]
"""
import json
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(override=True)  # .env manda, mesmo que haja variavel de ambiente antiga
except Exception:
    pass

from padelpro_vision.analysis.gemini_match import analyze_full_match

DEFAULT_VIDEO = r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4"
VIDEO = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_VIDEO)

if not os.environ.get("GEMINI_API_KEY", "").strip():
    print("FALTA a chave. Abre o ficheiro .env e adiciona uma linha:")
    print("    GEMINI_API_KEY=a_tua_chave_aqui")
    print("Guarda e corre de novo.")
    sys.exit(1)

if not VIDEO.exists():
    print(f"Video nao encontrado: {VIDEO}")
    sys.exit(1)

print(f"A analisar com o Gemini: {VIDEO.name}")
print("(envia o video para o Gemini e espera a resposta — alguns minutos)\n")

rep = analyze_full_match(VIDEO)

out = Path(r"C:\Users\joaom\Downloads") / f"gemini_{VIDEO.stem}.json"
out.write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")

rallies_v2 = rep.get("rallies_v2") or []
pancadas = [p for r in rallies_v2 for p in r.get("pancadas", [])]

print(f"rallies={len(rallies_v2)}  pancadas(Gemini)={len(pancadas)}  duracao_s={rep.get('duration_s')}")
print(f"resultado={rep.get('final_score', {}).get('detail', '?')}  confianca={rep.get('confidence')}")
print("shot_counts:", json.dumps(rep.get("shot_counts", {}), ensure_ascii=False))
print("\n-- pancadas do Gemini (tempo - jogador - tipo - zona) --")
for i, p in enumerate(pancadas, 1):
    print(f"{i:2d}. {p.get('timestamp')}  {p.get('jogador')}  {p.get('tipo')}  {p.get('zona')}")
print(f"\nJSON completo guardado em: {out}")
