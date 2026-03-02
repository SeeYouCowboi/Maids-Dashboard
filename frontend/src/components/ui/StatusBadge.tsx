interface StatusBadgeProps {
  status: string;
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

export function StatusBadge({ status, variant }: StatusBadgeProps) {
  const variantMap = {
    success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    error: 'bg-red-100 text-red-700 border-red-200',
    info: 'bg-blue-100 text-blue-700 border-blue-200',
    neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold border ${variantMap[variant]}`}
    >
      {status}
    </span>
  );
}
