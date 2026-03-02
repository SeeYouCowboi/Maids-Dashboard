import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-gray-300 mb-4">{icon}</div>}
      <p className="text-gray-400 font-medium mb-4">{message}</p>
      {action}
    </div>
  );
}
