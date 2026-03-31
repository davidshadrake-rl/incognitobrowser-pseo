'use client';

import { ToolPage } from '@/components/ToolPage';

interface ToolData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  description: string;
  inputs: Array<{
    id: string;
    label: string;
    type: 'text' | 'url' | 'email' | 'textarea' | 'select' | 'number';
    placeholder: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  educational: {
    howItWorks?: string;
    tips?: string[];
    commonMistakes?: string[];
  };
}

function DefaultToolRenderer({ inputs }: { inputs: Record<string, string> }) {
  const hasInput = Object.values(inputs).some(v => v.trim() !== '');

  if (!hasInput) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 text-center text-gray-500">
        Enter values above and click Analyze to see results.
      </div>
    );
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-6">
      <h3 className="font-semibold text-green-800 mb-3">Analysis Results</h3>
      <div className="space-y-2">
        {Object.entries(inputs).map(([key, value]) => (
          value && (
            <div key={key} className="flex items-start gap-2 text-sm">
              <span className="text-green-600 font-medium">{key}:</span>
              <span className="text-green-800">{value}</span>
            </div>
          )
        ))}
      </div>
      <p className="mt-4 text-sm text-green-700">
        For a detailed analysis, download Incognito Browser for enhanced privacy protection.
      </p>
    </div>
  );
}

export function ToolPageClient({ data, nicheName }: { data: ToolData; nicheName: string }) {
  return (
    <ToolPage
      data={data}
      nicheName={nicheName}
      renderTool={(inputs) => <DefaultToolRenderer inputs={inputs} />}
    />
  );
}
