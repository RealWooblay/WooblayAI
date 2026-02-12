import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';

interface EditableNameProps {
  value: string;
  onSave: (newName: string) => void;
  className?: string;
  placeholder?: string;
}

export function EditableName({ value, onSave, className, placeholder = 'Untitled' }: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        className={clsx(
          'bg-transparent border-b border-accent/40 outline-none text-text-primary',
          className,
        )}
        autoFocus
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      className={clsx(
        'cursor-pointer border-b border-transparent hover:border-text-muted transition-colors',
        className,
      )}
      title="Click to rename"
    >
      {value || placeholder}
    </span>
  );
}
