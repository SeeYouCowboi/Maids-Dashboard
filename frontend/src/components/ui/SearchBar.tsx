import React from 'react';
import { Search } from 'lucide-react';

interface SearchBarProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  actions?: React.ReactNode;
}

export function SearchBar({ placeholder, value, onChange, actions }: SearchBarProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl pl-10 pr-4 py-2 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100 transition-all duration-300"
        />
      </div>
      {actions}
    </div>
  );
}
