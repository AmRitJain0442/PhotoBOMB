import React from 'react';

export const EdlEditor: React.FC<{
  text: string;
  errors: string[];
  onChange: (t: string) => void;
  onLoadFixture: () => void;
}> = ({text, errors, onChange, onLoadFixture}) => {
  const format = () => {
    try {
      onChange(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      // leave text as-is; error already shown
    }
  };
  return (
    <div className="editor">
      <div className="toolbar">
        <button onClick={format}>format json</button>
        <button onClick={onLoadFixture}>load fixture</button>
      </div>
      <textarea
        spellCheck={false}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        aria-label="EDL JSON"
      />
      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
