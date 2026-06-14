import { UploadForm } from "@/components/UploadForm";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-3">PadelPro Vision</h1>
          <p className="text-gray-400">Análise de jogo com Gemini AI</p>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6">
          <UploadForm />
        </div>
      </div>
    </div>
  );
}
